import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")

        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(
        self,
        email: str,
        password: str | None = None,
        **extra_fields,
    ):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email=email, password=password, **extra_fields)


class User(AbstractUser):
    username = None
    email = models.EmailField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    def __str__(self) -> str:
        return self.email


class CryptoIdentity(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="crypto_identity",
    )
    key_id = models.CharField(max_length=64, unique=True)
    encryption_public_key = models.TextField()
    signing_public_key = models.TextField()
    fingerprint = models.CharField(max_length=128)
    key_package = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("user__email",)

    def __str__(self) -> str:
        return f"{self.user} ({self.fingerprint})"


class Contact(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        BLOCKED = "blocked", "Blocked"

    user_a = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contacts_started",
    )
    user_b = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contacts_received",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACCEPTED,
    )
    user_a_key_id = models.CharField(max_length=64, blank=True, default="")
    user_a_fingerprint = models.CharField(max_length=128, blank=True, default="")
    user_a_verified_at = models.DateTimeField(null=True, blank=True)
    user_b_key_id = models.CharField(max_length=64, blank=True, default="")
    user_b_fingerprint = models.CharField(max_length=128, blank=True, default="")
    user_b_verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=~Q(user_a=models.F("user_b")),
                name="contact_users_must_differ",
            ),
        ]
        ordering = ("user_a__email", "user_b__email")

    @classmethod
    def accepted_contact_user_ids_for(cls, user: "User") -> list[int]:
        contacts = cls.objects.filter(status=cls.Status.ACCEPTED).filter(
            Q(user_a=user) | Q(user_b=user)
        )

        contact_ids: list[int] = []
        for contact in contacts:
            if contact.user_a_id == user.id:
                contact_ids.append(contact.user_b_id)
            else:
                contact_ids.append(contact.user_a_id)
        return contact_ids

    def other_user_for(self, user: "User") -> User:
        if self.user_a_id == user.id:
            return self.user_b
        if self.user_b_id == user.id:
            return self.user_a
        raise ValidationError("This user is not part of the contact.")

    def _side_for(self, user: "User") -> str:
        if self.user_a_id == user.id:
            return "a"
        if self.user_b_id == user.id:
            return "b"
        raise ValidationError("This user is not part of the contact.")

    def key_id_for(self, user: "User") -> str:
        return getattr(self, f"user_{self._side_for(user)}_key_id")

    def fingerprint_for(self, user: "User") -> str:
        return getattr(self, f"user_{self._side_for(user)}_fingerprint")

    def verified_at_for(self, user: "User"):
        return getattr(self, f"user_{self._side_for(user)}_verified_at")

    def is_verified_by(self, user: "User") -> bool:
        return self.verified_at_for(user) is not None

    def keys_current(self) -> bool:
        identities = CryptoIdentity.objects.in_bulk(
            [self.user_a_id, self.user_b_id], field_name="user_id"
        )
        return all(
            identity is not None
            and identity.key_id == snapshot_key_id
            and identity.fingerprint == snapshot_fingerprint
            for identity, snapshot_key_id, snapshot_fingerprint in (
                (
                    identities.get(self.user_a_id),
                    self.user_a_key_id,
                    self.user_a_fingerprint,
                ),
                (
                    identities.get(self.user_b_id),
                    self.user_b_key_id,
                    self.user_b_fingerprint,
                ),
            )
        )

    def is_sendable(self) -> bool:
        return self.status == self.Status.ACCEPTED and self.keys_current()

    def mark_verified_by(self, user: "User") -> None:
        side = self._side_for(user)
        setattr(self, f"user_{side}_verified_at", timezone.now())
        self.save(update_fields=[f"user_{side}_verified_at"])

    def clean(self):
        super().clean()

        if self.user_a_id == self.user_b_id:
            raise ValidationError("A user cannot add themselves as a contact.")

        if not self.user_a_id or not self.user_b_id:
            return

        duplicate_exists = (
            Contact.objects.exclude(pk=self.pk)
            .filter(
                Q(user_a=self.user_a, user_b=self.user_b)
                | Q(user_a=self.user_b, user_b=self.user_a)
            )
            .exists()
        )
        if duplicate_exists:
            raise ValidationError("This contact relationship already exists.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.user_a} <-> {self.user_b}"


class ConnectionCode(models.Model):
    code = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connection_codes",
    )
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    @classmethod
    def create_for_user(
        cls,
        user: User,
        *,
        lifetime: timedelta = timedelta(hours=24),
    ) -> "ConnectionCode":
        code = cls._generate_unique_code()
        return cls.objects.create(
            code=code,
            created_by=user,
            expires_at=timezone.now() + lifetime,
        )

    @classmethod
    def _generate_unique_code(cls) -> str:
        while True:
            code = secrets.token_hex(4).upper()
            if not cls.objects.filter(code=code).exists():
                return code

    @property
    def is_expired(self) -> bool:
        return self.expires_at <= timezone.now()

    def mark_used(self):
        self.used = True
        self.save(update_fields=["used"])

    def __str__(self) -> str:
        return self.code


class Letter(models.Model):
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_letters",
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="received_letters",
    )
    encrypted_file = models.FileField(upload_to="letters/")
    package_id = models.CharField(max_length=128, unique=True, null=True, blank=True)
    delivery_timestamp = models.DateTimeField(db_index=True)
    downloaded = models.BooleanField(default=False)
    deletion_timestamp = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=~Q(sender=models.F("recipient")),
                name="letter_sender_and_recipient_must_differ",
            ),
        ]

    def clean(self):
        super().clean()

        if self.sender_id == self.recipient_id:
            raise ValidationError("A user cannot send a letter to themselves.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"Letter from {self.sender} to {self.recipient}"
