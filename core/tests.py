import json
import tempfile
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.urls import reverse
from django.utils import timezone

from core.delivery import calculate_delivery_timestamp
from core.models import ConnectionCode, Contact, CryptoIdentity, Letter, User


def make_identity(user, key_id=None, fingerprint=None):
    key_id = key_id or f"key-{user.pk}"
    fingerprint = fingerprint or f"fingerprint-{user.pk}"
    return CryptoIdentity.objects.create(
        user=user,
        key_id=key_id,
        encryption_public_key=f"encryption-{user.pk}",
        signing_public_key=f"signing-{user.pk}",
        fingerprint=fingerprint,
        key_package={"key_id": key_id},
    )


def make_verified_contact(user_a, user_b):
    identity_a = make_identity(user_a)
    identity_b = make_identity(user_b)
    return Contact.objects.create(
        user_a=user_a,
        user_b=user_b,
        status=Contact.Status.ACCEPTED,
        user_a_key_id=identity_a.key_id,
        user_a_fingerprint=identity_a.fingerprint,
        user_a_verified_at=timezone.now(),
        user_b_key_id=identity_b.key_id,
        user_b_fingerprint=identity_b.fingerprint,
        user_b_verified_at=timezone.now(),
    )


def make_envelope(sender_key_id, recipient_key_id, letter_id="letter-1"):
    return {
        "format_version": 1,
        "algorithm": "xchacha20poly1305-ietf",
        "letter_id": letter_id,
        "sender_key_id": sender_key_id,
        "recipient_key_id": recipient_key_id,
        "ciphertext": "ciphertext",
        "nonce": "nonce",
        "wrapped_content_key": "wrapped-content-key",
        "signature": "signature",
    }


class UserModelTests(TestCase):
    def test_create_user_uses_email_as_identifier(self):
        user = User.objects.create_user(
            email="Person@Example.com", password="test-pass-123"
        )

        self.assertEqual(user.email, "Person@example.com")
        self.assertIsNone(user.username)
        self.assertIsNotNone(user.created_at)
        self.assertTrue(user.check_password("test-pass-123"))

    def test_create_user_requires_email(self):
        with self.assertRaisesMessage(ValueError, "An email address is required."):
            User.objects.create_user(email="", password="test-pass-123")


class DeliveryDelayTests(TestCase):
    @override_settings(
        LETTER_DELAY_MODE="minutes",
        LETTER_DELAY_MINUTES=(1, 10),
    )
    def test_testing_delay_is_between_one_and_ten_minutes(self):
        now = timezone.now()
        delivery_timestamp = calculate_delivery_timestamp(now)

        self.assertGreaterEqual(delivery_timestamp, now + timedelta(minutes=1))
        self.assertLessEqual(delivery_timestamp, now + timedelta(minutes=10))

    @override_settings(
        LETTER_DELAY_MODE="days",
        LETTER_DELAY_DAYS=(3, 14),
    )
    def test_production_delay_is_between_three_and_fourteen_days(self):
        now = timezone.now()
        delivery_timestamp = calculate_delivery_timestamp(now)

        self.assertGreaterEqual(delivery_timestamp, now + timedelta(days=3))
        self.assertLessEqual(delivery_timestamp, now + timedelta(days=14))


class ContactModelTests(TestCase):
    def setUp(self):
        self.user_one = User.objects.create_user(
            email="one@example.com",
            password="test-pass-123",
        )
        self.user_two = User.objects.create_user(
            email="two@example.com",
            password="test-pass-123",
        )

    def test_contact_cannot_link_same_user_twice(self):
        contact = Contact(user_a=self.user_one, user_b=self.user_one)

        with self.assertRaisesMessage(
            ValidationError,
            "A user cannot add themselves as a contact.",
        ):
            contact.full_clean()

    def test_contact_cannot_be_duplicated_in_reverse_order(self):
        Contact.objects.create(user_a=self.user_one, user_b=self.user_two)

        duplicate = Contact(user_a=self.user_two, user_b=self.user_one)
        with self.assertRaisesMessage(
            ValidationError,
            "This contact relationship already exists.",
        ):
            duplicate.full_clean()

    def test_contact_defaults_to_accepted_status(self):
        contact = Contact.objects.create(user_a=self.user_one, user_b=self.user_two)

        self.assertEqual(contact.status, Contact.Status.ACCEPTED)


class ConnectionCodeModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="creator@example.com",
            password="test-pass-123",
        )

    def test_connection_code_reports_unexpired_state(self):
        connection_code = ConnectionCode.objects.create(
            code="ABC123",
            created_by=self.user,
            expires_at=timezone.now() + timedelta(hours=1),
        )

        self.assertFalse(connection_code.is_expired)

    def test_connection_code_reports_expired_state(self):
        connection_code = ConnectionCode.objects.create(
            code="XYZ789",
            created_by=self.user,
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        self.assertTrue(connection_code.is_expired)


class LetterModelTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

        self.override = override_settings(MEDIA_ROOT=self.temp_dir.name)
        self.override.enable()
        self.addCleanup(self.override.disable)

        self.sender = User.objects.create_user(
            email="sender@example.com",
            password="test-pass-123",
        )
        self.recipient = User.objects.create_user(
            email="recipient@example.com",
            password="test-pass-123",
        )

    def test_letter_cannot_be_sent_to_self(self):
        letter = Letter(
            sender=self.sender,
            recipient=self.sender,
            encrypted_file=SimpleUploadedFile("letter.txt", b"hello"),
            delivery_timestamp=timezone.now() + timedelta(days=1),
        )

        with self.assertRaisesMessage(
            ValidationError,
            "A user cannot send a letter to themselves.",
        ):
            letter.full_clean()

    def test_letter_defaults_to_not_downloaded(self):
        letter = Letter.objects.create(
            sender=self.sender,
            recipient=self.recipient,
            encrypted_file=SimpleUploadedFile("letter.txt", b"hello"),
            delivery_timestamp=timezone.now() + timedelta(days=1),
        )

        self.assertFalse(letter.downloaded)
        self.assertIsNone(letter.deletion_timestamp)


class BrowserFlowTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

        self.override = override_settings(MEDIA_ROOT=self.temp_dir.name)
        self.override.enable()
        self.addCleanup(self.override.disable)

        self.client = Client()

    def test_signup_creates_user_and_logs_them_in(self):
        response = self.client.post(
            reverse("signup"),
            {
                "email": "new@example.com",
                "password1": "secure-pass-123",
                "password2": "secure-pass-123",
            },
            follow=True,
        )

        self.assertRedirects(response, reverse("crypto-setup"))
        self.assertTrue(User.objects.filter(email="new@example.com").exists())
        self.assertEqual(response.wsgi_request.user.email, "new@example.com")

    def test_signup_explains_account_password_requirements(self):
        response = self.client.get(reverse("signup"))

        self.assertContains(response, "Account password")
        self.assertContains(response, "At least 8 characters")
        self.assertContains(response, "Not made up only of numbers")

    def test_new_user_can_open_crypto_setup(self):
        self.client.force_login(
            User.objects.create_user(
                email="setup@example.com",
                password="secure-pass-123",
            )
        )

        response = self.client.get(reverse("crypto-setup"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Open my letterbox")
        self.assertContains(response, "automatic")
        self.assertContains(response, "recovery phrase")

    def test_user_can_generate_and_redeem_connection_code(self):
        owner = User.objects.create_user(
            email="owner@example.com",
            password="secure-pass-123",
        )
        recipient = User.objects.create_user(
            email="recipient@example.com",
            password="secure-pass-123",
        )
        make_identity(owner)
        make_identity(recipient)

        self.client.login(email="owner@example.com", password="secure-pass-123")
        response = self.client.post(
            reverse("create-connection-code"),
            follow=True,
        )

        self.assertRedirects(response, reverse("dashboard"))
        connection_code = ConnectionCode.objects.get(created_by=owner, used=False)

        self.client.logout()
        self.client.login(email="recipient@example.com", password="secure-pass-123")
        response = self.client.post(
            reverse("redeem-connection-code"),
            {"code": connection_code.code.lower()},
            follow=True,
        )

        self.assertRedirects(response, reverse("dashboard"))
        self.assertTrue(
            Contact.objects.filter(
                user_a=owner,
                user_b=recipient,
                status=Contact.Status.ACCEPTED,
            ).exists()
        )
        connection_code.refresh_from_db()
        self.assertTrue(connection_code.used)

    def test_redeeming_expired_code_is_rejected(self):
        owner = User.objects.create_user(
            email="owner@example.com",
            password="secure-pass-123",
        )
        recipient = User.objects.create_user(
            email="recipient@example.com",
            password="secure-pass-123",
        )
        expired_code = ConnectionCode.objects.create(
            code="EXPIRED1",
            created_by=owner,
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        self.client.login(email="recipient@example.com", password="secure-pass-123")
        response = self.client.post(
            reverse("redeem-connection-code"),
            {"code": expired_code.code},
        )

        self.assertContains(response, "That connection code has expired.")
        self.assertFalse(
            Contact.objects.filter(
                user_a=owner,
                user_b=recipient,
            ).exists()
        )

    def test_compose_only_lists_mutually_verified_contacts(self):
        sender = User.objects.create_user(
            email="sender@example.com",
            password="secure-pass-123",
        )
        recipient = User.objects.create_user(
            email="recipient@example.com",
            password="secure-pass-123",
        )
        User.objects.create_user(
            email="stranger@example.com",
            password="secure-pass-123",
        )

        make_verified_contact(sender, recipient)

        self.client.login(email="sender@example.com", password="secure-pass-123")
        response = self.client.get(reverse("compose-letter"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "recipient@example.com")
        self.assertNotContains(response, "stranger@example.com")

    def test_authenticated_user_can_send_to_contact_and_recipient_can_download_letter(
        self,
    ):
        sender = User.objects.create_user(
            email="sender@example.com",
            password="secure-pass-123",
        )
        recipient = User.objects.create_user(
            email="recipient@example.com",
            password="secure-pass-123",
        )

        sender_identity = make_identity(sender)
        recipient_identity = make_identity(recipient)
        Contact.objects.create(
            user_a=sender,
            user_b=recipient,
            status=Contact.Status.ACCEPTED,
            user_a_key_id=sender_identity.key_id,
            user_a_fingerprint=sender_identity.fingerprint,
            user_a_verified_at=timezone.now(),
            user_b_key_id=recipient_identity.key_id,
            user_b_fingerprint=recipient_identity.fingerprint,
            user_b_verified_at=timezone.now(),
        )

        self.client.login(email="sender@example.com", password="secure-pass-123")
        envelope = make_envelope(
            sender_identity.key_id,
            recipient_identity.key_id,
        )
        envelope["ciphertext"] = "a" * 400
        response = self.client.post(
            reverse("compose-letter"),
            data=json.dumps(
                {
                    "recipient": recipient.pk,
                    "envelope": envelope,
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)

        letter = Letter.objects.get(sender=sender, recipient=recipient)
        self.assertGreater(letter.delivery_timestamp, timezone.now())
        self.assertLessEqual(
            letter.delivery_timestamp,
            timezone.now() + timedelta(minutes=10),
        )
        letter.delivery_timestamp = timezone.now() - timedelta(seconds=1)
        letter.save(update_fields=["delivery_timestamp"])

        self.client.logout()
        self.client.login(email="recipient@example.com", password="secure-pass-123")

        reader_response = self.client.get(reverse("read-letter", args=[letter.pk]))
        self.assertEqual(reader_response.status_code, 200)
        self.assertContains(reader_response, "Your letter is still sealed")

        envelope_response = self.client.get(
            reverse("letter-envelope", args=[letter.pk])
        )
        self.assertEqual(envelope_response.status_code, 200)
        self.assertEqual(envelope_response.json()["envelope"]["letter_id"], "letter-1")
        self.assertEqual(
            envelope_response.json()["sender_key"]["key_id"], sender_identity.key_id
        )
        self.assertEqual(
            envelope_response.json()["sender_key"]["fingerprint"],
            sender_identity.fingerprint,
        )
        letter.refresh_from_db()
        self.assertFalse(letter.downloaded)

        opened_response = self.client.post(
            reverse("letter-opened", args=[letter.pk]),
        )
        self.assertEqual(opened_response.status_code, 200)
        letter.refresh_from_db()
        self.assertTrue(letter.downloaded)
        self.assertIsNotNone(letter.deletion_timestamp)

        download_response = self.client.get(
            reverse("download-letter", args=[letter.pk])
        )

        self.assertEqual(download_response.status_code, 200)
        letter.refresh_from_db()
        self.assertTrue(letter.downloaded)
        self.assertIsNotNone(letter.deletion_timestamp)

    def test_cleanup_command_deletes_expired_envelopes(self):
        sender = User.objects.create_user(
            email="cleanup-sender@example.com",
            password="secure-pass-123",
        )
        recipient = User.objects.create_user(
            email="cleanup-recipient@example.com",
            password="secure-pass-123",
        )
        letter = Letter.objects.create(
            sender=sender,
            recipient=recipient,
            encrypted_file=SimpleUploadedFile("expired.barua", b"ciphertext"),
            delivery_timestamp=timezone.now() - timedelta(days=31),
        )
        path = letter.encrypted_file.path

        call_command("cleanup_letters")

        self.assertFalse(Letter.objects.filter(pk=letter.pk).exists())
        self.assertFalse(Path(path).exists())

    def test_recipient_cannot_download_undelivered_letter(self):
        sender = User.objects.create_user(
            email="sender@example.com",
            password="secure-pass-123",
        )
        recipient = User.objects.create_user(
            email="recipient@example.com",
            password="secure-pass-123",
        )
        letter = Letter.objects.create(
            sender=sender,
            recipient=recipient,
            encrypted_file=SimpleUploadedFile("future.txt", b"hello"),
            delivery_timestamp=timezone.now() + timedelta(days=5),
        )

        self.client.login(email="recipient@example.com", password="secure-pass-123")
        response = self.client.get(reverse("download-letter", args=[letter.pk]))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            self.client.get(reverse("read-letter", args=[letter.pk])).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(reverse("letter-envelope", args=[letter.pk])).status_code,
            404,
        )

    def test_non_contact_recipient_is_rejected(self):
        sender = User.objects.create_user(
            email="sender@example.com",
            password="secure-pass-123",
        )
        recipient = User.objects.create_user(
            email="recipient@example.com",
            password="secure-pass-123",
        )

        self.client.login(email="sender@example.com", password="secure-pass-123")
        response = self.client.post(
            reverse("compose-letter"),
            data=json.dumps(
                {
                    "recipient": recipient.pk,
                    "envelope": make_envelope("sender-key", "recipient-key"),
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            Letter.objects.filter(sender=sender, recipient=recipient).exists()
        )

    def test_composer_explains_verification_requirement(self):
        user = User.objects.create_user(
            email="production@example.com",
            password="secure-pass-123",
        )
        self.client.force_login(user)

        response = self.client.get(reverse("compose-letter"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Your desk needs a correspondent")


class ContactVerificationTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user_a = User.objects.create_user(
            email="alice@example.com",
            password="secure-pass-123",
        )
        self.user_b = User.objects.create_user(
            email="bob@example.com",
            password="secure-pass-123",
        )
        self.identity_a = make_identity(self.user_a)
        self.identity_b = make_identity(self.user_b)
        self.contact = Contact.objects.create(
            user_a=self.user_a,
            user_b=self.user_b,
            status=Contact.Status.ACCEPTED,
            user_a_key_id=self.identity_a.key_id,
            user_a_fingerprint=self.identity_a.fingerprint,
            user_b_key_id=self.identity_b.key_id,
            user_b_fingerprint=self.identity_b.fingerprint,
        )

    def test_contact_is_sendable_before_optional_manual_verification(self):
        self.client.force_login(self.user_a)
        self.assertTrue(self.contact.is_sendable())
        response = self.client.post(
            reverse("verify-contact-key", args=[self.contact.pk])
        )

        self.assertRedirects(response, reverse("dashboard"))
        self.contact.refresh_from_db()
        self.assertTrue(self.contact.is_verified_by(self.user_a))
        self.assertFalse(self.contact.is_verified_by(self.user_b))
        self.assertTrue(self.contact.is_sendable())

        self.client.force_login(self.user_b)
        self.client.post(reverse("verify-contact-key", args=[self.contact.pk]))
        self.contact.refresh_from_db()
        self.assertTrue(self.contact.is_sendable())

    def test_verification_is_blocked_when_a_snapshot_is_stale(self):
        self.identity_b.fingerprint = "new-fingerprint"
        self.identity_b.save(update_fields=["fingerprint"])

        self.client.force_login(self.user_a)
        response = self.client.post(
            reverse("verify-contact-key", args=[self.contact.pk])
        )

        self.assertRedirects(response, reverse("dashboard"))
        self.contact.refresh_from_db()
        self.assertFalse(self.contact.is_verified_by(self.user_a))
        self.assertFalse(self.contact.keys_current())

    def test_recipient_key_endpoint_only_exposes_sendable_contacts(self):
        self.client.force_login(self.user_a)
        response = self.client.get(reverse("recipient-key", args=[self.user_b.pk]))
        self.assertEqual(response.status_code, 200)

        self.contact.user_a_verified_at = timezone.now()
        self.contact.user_b_verified_at = timezone.now()
        self.contact.save(update_fields=["user_a_verified_at", "user_b_verified_at"])
        response = self.client.get(reverse("recipient-key", args=[self.user_b.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["key_id"], self.identity_b.key_id)


class CryptoIdentityFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="crypto@example.com",
            password="secure-pass-123",
        )
        self.client.force_login(self.user)

    def make_package(self, key_id="identity-1"):
        encrypted_section = {
            "algorithm": "xchacha20poly1305-ietf",
            "ciphertext": "ciphertext",
            "nonce": "nonce",
        }
        return {
            "format_version": 1,
            "key_id": key_id,
            "encryption_public_key": "encryption-public-key",
            "signing_public_key": "signing-public-key",
            "fingerprint": "fingerprint",
            "encrypted_private_bundle": encrypted_section,
            "passphrase_wrap": {
                **encrypted_section,
                "purpose": "passphrase",
                "salt": "salt",
                "kdf": "argon2id13",
                "kdf_parameters": {},
            },
            "recovery_wrap": {
                **encrypted_section,
                "purpose": "recovery",
                "salt": "salt",
                "kdf": "argon2id13",
                "kdf_parameters": {},
            },
        }

    def post_package(self, package):
        return self.client.post(
            reverse("crypto-identity"),
            data=json.dumps(package),
            content_type="application/json",
        )

    def test_user_can_store_and_fetch_opaque_key_package(self):
        package = self.make_package()

        response = self.post_package(package)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["key_id"], package["key_id"])
        self.assertEqual(
            self.client.get(reverse("crypto-identity")).json(),
            package,
        )
        self.assertEqual(
            CryptoIdentity.objects.get(user=self.user).key_package,
            package,
        )

    def test_user_can_store_recovery_only_key_package(self):
        package = self.make_package()
        del package["passphrase_wrap"]

        response = self.post_package(package)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            self.client.get(reverse("crypto-identity")).json(),
            package,
        )

    def test_user_can_update_wrappers_without_replacing_identity(self):
        package = self.make_package()
        self.post_package(package)
        updated_package = {**package, "passphrase_wrap": {**package["passphrase_wrap"]}}
        updated_package["passphrase_wrap"]["ciphertext"] = "new-ciphertext"

        response = self.post_package(updated_package)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["created"])
        self.assertEqual(
            self.client.get(reverse("crypto-identity")).json(),
            updated_package,
        )

    def test_key_rotation_requires_a_separate_flow(self):
        self.post_package(self.make_package())

        response = self.post_package(self.make_package(key_id="identity-2"))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self.client.get(reverse("crypto-identity")).json()["key_id"],
            "identity-1",
        )

    def test_malformed_key_package_is_rejected(self):
        response = self.post_package({"format_version": 1})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(CryptoIdentity.objects.filter(user=self.user).exists())
