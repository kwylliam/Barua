import json
from datetime import timedelta
from pathlib import Path

from django import forms
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.http import (
    FileResponse,
    Http404,
    HttpRequest,
    HttpResponse,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse_lazy
from django.utils import timezone
from django.views.generic import (
    CreateView,
    FormView,
    RedirectView,
    TemplateView,
    View,
)

from core.crypto_package import validate_key_package
from core.delivery import calculate_delivery_timestamp
from core.forms import ConnectionCodeRedeemForm, SignUpForm
from core.letter_package import validate_letter_package
from core.models import ConnectionCode, Contact, CryptoIdentity, Letter, User


def home(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return redirect("dashboard")
    return redirect("login")


class SignUpView(CreateView):
    form_class = SignUpForm
    template_name = "core/signup.html"
    success_url = reverse_lazy("crypto-setup")

    def dispatch(self, request: HttpRequest, *args, **kwargs) -> HttpResponse:
        if request.user.is_authenticated:
            return redirect("dashboard")
        return super().dispatch(request, *args, **kwargs)

    def form_valid(self, form: SignUpForm) -> HttpResponse:
        response = super().form_valid(form)
        login(self.request, self.object)
        messages.success(self.request, "Your account is ready.")
        return response


class CryptoSetupView(LoginRequiredMixin, TemplateView):
    template_name = "core/crypto_setup.html"

    def dispatch(self, request: HttpRequest, *args, **kwargs) -> HttpResponse:
        if CryptoIdentity.objects.filter(user=request.user).exists():
            return redirect("dashboard")
        return super().dispatch(request, *args, **kwargs)


class CryptoIdentityView(LoginRequiredMixin, View):
    def get(self, request: HttpRequest) -> JsonResponse:
        try:
            identity = request.user.crypto_identity
        except CryptoIdentity.DoesNotExist as exc:
            raise Http404("Cryptographic identity has not been created.") from exc

        return JsonResponse(identity.key_package)

    def post(self, request: HttpRequest) -> JsonResponse:
        if len(request.body) > 512 * 1024:
            return JsonResponse({"error": "Key package is too large."}, status=413)

        try:
            package = json.loads(request.body)
            validate_key_package(package)
        except (json.JSONDecodeError, UnicodeDecodeError, ValidationError) as exc:
            message = (
                exc.message if isinstance(exc, ValidationError) else "Invalid JSON."
            )
            return JsonResponse({"error": message}, status=400)

        with transaction.atomic():
            locked_user = User.objects.select_for_update().get(pk=request.user.pk)
            identity, created = (
                CryptoIdentity.objects.select_for_update().get_or_create(
                    user=locked_user,
                    defaults={
                        "key_id": package["key_id"],
                        "encryption_public_key": package["encryption_public_key"],
                        "signing_public_key": package["signing_public_key"],
                        "fingerprint": package["fingerprint"],
                        "key_package": package,
                    },
                )
            )

            if not created and identity.key_id != package["key_id"]:
                return JsonResponse(
                    {
                        "error": (
                            "A new identity requires an explicit rotation flow; "
                            "the existing identity was not replaced."
                        )
                    },
                    status=409,
                )

            if not created:
                identity.encryption_public_key = package["encryption_public_key"]
                identity.signing_public_key = package["signing_public_key"]
                identity.fingerprint = package["fingerprint"]
                identity.key_package = package
                identity.save(
                    update_fields=[
                        "encryption_public_key",
                        "signing_public_key",
                        "fingerprint",
                        "key_package",
                        "updated_at",
                    ]
                )

        return JsonResponse(
            {
                "key_id": identity.key_id,
                "fingerprint": identity.fingerprint,
                "created": created,
            },
            status=201 if created else 200,
        )


class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "core/dashboard.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        now = timezone.now()
        user = self.request.user
        contact_ids = Contact.accepted_contact_user_ids_for(user)

        context["available_letters"] = user.received_letters.filter(
            delivery_timestamp__lte=now
        ).order_by("delivery_timestamp")
        context["scheduled_letters"] = user.received_letters.filter(
            delivery_timestamp__gt=now
        ).order_by("delivery_timestamp")
        context["sent_letters"] = user.sent_letters.order_by("-delivery_timestamp")
        context["has_crypto_identity"] = CryptoIdentity.objects.filter(
            user=user
        ).exists()
        context["contacts"] = User.objects.filter(pk__in=contact_ids).order_by("email")
        contacts = (
            Contact.objects.filter(
                status=Contact.Status.ACCEPTED,
            )
            .filter(Q(user_a=user) | Q(user_b=user))
            .select_related("user_a", "user_b")
        )
        context["contact_cards"] = [
            {
                "contact": contact,
                "user": contact.other_user_for(user),
                "fingerprint": contact.fingerprint_for(contact.other_user_for(user)),
                "verified_by_me": contact.is_verified_by(user),
                "other_verified": contact.is_verified_by(contact.other_user_for(user)),
                "keys_current": contact.keys_current(),
                "sendable": contact.is_sendable(),
            }
            for contact in contacts
        ]
        context["active_connection_codes"] = user.connection_codes.filter(
            used=False,
            expires_at__gt=now,
        ).order_by("expires_at")
        context["redeem_form"] = kwargs.get("redeem_form") or ConnectionCodeRedeemForm(
            user=user
        )
        return context


class LetterComposeView(LoginRequiredMixin, View):
    template_name = "core/compose_letter.html"

    def get(self, request: HttpRequest, *args, **kwargs) -> HttpResponse:
        return render(
            request,
            self.template_name,
            {"sendable_contacts": self._sendable_contacts(request.user)},
        )

    def post(self, request: HttpRequest, *args, **kwargs) -> JsonResponse:
        if len(request.body) > 20 * 1024 * 1024:
            return JsonResponse(
                {"error": "The letter package is too large."}, status=413
            )

        try:
            payload = json.loads(request.body)
            recipient_id = int(payload["recipient"])
            envelope = validate_letter_package(payload["envelope"])
        except (
            KeyError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
            ValidationError,
        ) as exc:
            message = (
                exc.message
                if isinstance(exc, ValidationError)
                else "Invalid letter package."
            )
            return JsonResponse({"error": message}, status=400)

        try:
            recipient = User.objects.get(pk=recipient_id)
        except User.DoesNotExist:
            return JsonResponse({"error": "That recipient does not exist."}, status=404)

        sender_identity = CryptoIdentity.objects.filter(user=request.user).first()
        recipient_identity = CryptoIdentity.objects.filter(user=recipient).first()
        contact = self._contact_for(request.user, recipient)
        if not sender_identity or not recipient_identity or not contact:
            return JsonResponse(
                {"error": "You can only send letters to an accepted contact."},
                status=403,
            )

        if not contact.is_sendable():
            return JsonResponse(
                {"error": "This contact's key needs attention before sending."},
                status=403,
            )

        if (
            envelope["sender_key_id"] != sender_identity.key_id
            or envelope["recipient_key_id"] != recipient_identity.key_id
        ):
            return JsonResponse(
                {"error": "The letter keys do not match the current contact keys."},
                status=409,
            )

        if Letter.objects.filter(package_id=envelope["letter_id"]).exists():
            return JsonResponse(
                {"error": "This letter was already submitted."}, status=409
            )

        delivery_timestamp = calculate_delivery_timestamp()

        letter = Letter.objects.create(
            sender=request.user,
            recipient=recipient,
            package_id=envelope["letter_id"],
            encrypted_file=ContentFile(
                json.dumps(envelope, separators=(",", ":")).encode("utf-8"),
                name=f"{envelope['letter_id']}.barua",
            ),
            delivery_timestamp=delivery_timestamp,
        )
        return JsonResponse(
            {
                "id": letter.pk,
                "delivery_timestamp": letter.delivery_timestamp.isoformat(),
            },
            status=201,
        )

    @staticmethod
    def _contact_for(sender: User, recipient: User) -> Contact | None:
        return (
            Contact.objects.filter(status=Contact.Status.ACCEPTED)
            .filter(
                Q(user_a=sender, user_b=recipient) | Q(user_a=recipient, user_b=sender)
            )
            .first()
        )

    @classmethod
    def _sendable_contacts(cls, user: User) -> list[dict]:
        contacts = (
            Contact.objects.filter(
                status=Contact.Status.ACCEPTED,
            )
            .filter(Q(user_a=user) | Q(user_b=user))
            .select_related("user_a", "user_b")
        )
        return [
            {"user": contact.other_user_for(user), "contact": contact}
            for contact in contacts
            if contact.is_sendable()
        ]


class ContactRecipientKeyView(LoginRequiredMixin, View):
    def get(self, request: HttpRequest, user_id: int) -> JsonResponse:
        recipient = get_object_or_404(User, pk=user_id)
        contact = LetterComposeView._contact_for(request.user, recipient)
        identity = CryptoIdentity.objects.filter(user=recipient).first()

        if not contact or not identity or not contact.is_sendable():
            return JsonResponse(
                {"error": "That recipient is not currently available for letters."},
                status=403,
            )

        return JsonResponse(
            {
                "key_id": identity.key_id,
                "encryption_public_key": identity.encryption_public_key,
                "signing_public_key": identity.signing_public_key,
                "fingerprint": identity.fingerprint,
            }
        )


class LetterReadView(LoginRequiredMixin, View):
    template_name = "core/read_letter.html"

    def get(self, request: HttpRequest, pk: int) -> HttpResponse:
        letter = get_object_or_404(request.user.received_letters, pk=pk)
        if letter.delivery_timestamp > timezone.now():
            raise Http404("This letter has not been delivered yet.")

        return render(request, self.template_name, {"letter": letter})


class LetterEnvelopeView(LoginRequiredMixin, View):
    def get(self, request: HttpRequest, pk: int) -> JsonResponse:
        letter = get_object_or_404(
            Letter.objects.select_related("sender", "recipient"),
            pk=pk,
            recipient=request.user,
        )
        if letter.delivery_timestamp > timezone.now():
            raise Http404("This letter has not been delivered yet.")

        contact = LetterComposeView._contact_for(letter.sender, letter.recipient)
        sender_identity = CryptoIdentity.objects.filter(user=letter.sender).first()
        recipient_identity = CryptoIdentity.objects.filter(user=request.user).first()
        if (
            not contact
            or not sender_identity
            or not recipient_identity
            or not contact.is_sendable()
        ):
            return JsonResponse(
                {"error": "The contact keys for this letter are no longer current."},
                status=409,
            )

        try:
            with letter.encrypted_file.open("rb") as encrypted_file:
                envelope = json.loads(encrypted_file.read())
            validate_letter_package(envelope)
        except (json.JSONDecodeError, UnicodeDecodeError, ValidationError):
            return JsonResponse(
                {"error": "The stored letter package is invalid."}, status=500
            )

        if (
            envelope["sender_key_id"] != sender_identity.key_id
            or envelope["recipient_key_id"] != recipient_identity.key_id
        ):
            return JsonResponse(
                {"error": "The letter identity metadata no longer matches."},
                status=409,
            )

        return JsonResponse(
            {
                "envelope": envelope,
                "sender_key": {
                    "key_id": sender_identity.key_id,
                    "encryption_public_key": sender_identity.encryption_public_key,
                    "signing_public_key": sender_identity.signing_public_key,
                    "fingerprint": sender_identity.fingerprint,
                },
            }
        )


class LetterOpenedView(LoginRequiredMixin, View):
    def post(self, request: HttpRequest, pk: int) -> JsonResponse:
        letter = get_object_or_404(
            Letter,
            pk=pk,
            recipient=request.user,
        )
        if letter.delivery_timestamp > timezone.now():
            raise Http404("This letter has not been delivered yet.")

        if not letter.downloaded:
            letter.downloaded = True
            letter.deletion_timestamp = timezone.now() + timedelta(
                days=settings.LETTER_OPEN_RETENTION_DAYS
            )
            letter.save(update_fields=["downloaded", "deletion_timestamp"])

        return JsonResponse({"opened": True})


class ConnectionCodeCreateView(LoginRequiredMixin, RedirectView):
    pattern_name = "dashboard"

    def post(self, request: HttpRequest, *args, **kwargs) -> HttpResponse:
        if not CryptoIdentity.objects.filter(user=request.user).exists():
            messages.error(
                request,
                "Set up your encrypted identity before creating a connection code.",
            )
            return redirect("crypto-setup")

        active_code = request.user.connection_codes.filter(
            used=False,
            expires_at__gt=timezone.now(),
        ).first()
        if active_code:
            messages.info(
                request,
                f"Your active connection code is {active_code.code}.",
            )
            return redirect(self.pattern_name)

        connection_code = ConnectionCode.create_for_user(request.user)
        messages.success(
            request,
            f"Connection code {connection_code.code} created. It expires in 24 hours.",
        )
        return redirect(self.pattern_name)


class ConnectionCodeRedeemView(LoginRequiredMixin, FormView):
    form_class = ConnectionCodeRedeemForm
    success_url = reverse_lazy("dashboard")

    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        kwargs["user"] = self.request.user
        return kwargs

    def form_valid(self, form: ConnectionCodeRedeemForm) -> HttpResponse:
        connection_code = form.connection_code
        if connection_code is None:
            raise ValueError("Validated redeem form is missing its connection code.")

        creator_identity = CryptoIdentity.objects.get(user=connection_code.created_by)
        recipient_identity = CryptoIdentity.objects.get(user=self.request.user)
        Contact.objects.create(
            user_a=connection_code.created_by,
            user_b=self.request.user,
            status=Contact.Status.ACCEPTED,
            user_a_key_id=creator_identity.key_id,
            user_a_fingerprint=creator_identity.fingerprint,
            user_b_key_id=recipient_identity.key_id,
            user_b_fingerprint=recipient_identity.fingerprint,
        )
        connection_code.mark_used()
        messages.success(
            self.request,
            f"You are now connected to {connection_code.created_by.email}.",
        )
        return redirect(self.success_url)

    def form_invalid(self, form: forms.Form) -> HttpResponse:
        dashboard_view = DashboardView()
        dashboard_view.setup(self.request)
        context = dashboard_view.get_context_data(redeem_form=form)
        return self.render_to_response(context)

    def render_to_response(self, context, **response_kwargs):
        from django.shortcuts import render

        return render(self.request, "core/dashboard.html", context, **response_kwargs)


class ContactKeyVerificationView(LoginRequiredMixin, View):
    def post(self, request: HttpRequest, pk: int) -> HttpResponse:
        contact = get_object_or_404(
            Contact.objects.select_related("user_a", "user_b"),
            pk=pk,
            status=Contact.Status.ACCEPTED,
        )

        if request.user.id not in {contact.user_a_id, contact.user_b_id}:
            raise Http404("Contact not found.")

        if (
            CryptoIdentity.objects.filter(
                user_id__in=[contact.user_a_id, contact.user_b_id]
            ).count()
            != 2
        ):
            messages.error(
                request,
                "Both users must have an encrypted identity before verification.",
            )
            return redirect("dashboard")

        if not contact.keys_current():
            messages.error(
                request,
                "A contact key changed. Reconnect with a new code before verifying it.",
            )
            return redirect("dashboard")

        contact.mark_verified_by(request.user)
        messages.success(
            request,
            f"Verified {contact.other_user_for(request.user).email}'s encryption key.",
        )
        return redirect("dashboard")


class LetterDownloadView(LoginRequiredMixin, View):
    def get(self, request: HttpRequest, pk: int) -> FileResponse:
        try:
            letter = request.user.received_letters.get(pk=pk)
        except Letter.DoesNotExist as exc:
            raise Http404("Letter not found.") from exc

        if letter.delivery_timestamp > timezone.now():
            raise Http404("This letter has not been delivered yet.")

        if not letter.downloaded:
            letter.downloaded = True
            letter.deletion_timestamp = timezone.now() + timedelta(
                days=settings.LETTER_OPEN_RETENTION_DAYS
            )
            letter.save(update_fields=["downloaded", "deletion_timestamp"])

        filename = Path(letter.encrypted_file.name).name
        return FileResponse(
            letter.encrypted_file.open("rb"),
            as_attachment=True,
            filename=filename,
        )
