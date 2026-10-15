from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.db.models import Q

from core.models import ConnectionCode, Contact, CryptoIdentity, User


class EmailAuthenticationForm(AuthenticationForm):
    username = forms.EmailField(
        label="Email",
        widget=forms.EmailInput(attrs={"autocomplete": "email"}),
    )


class SignUpForm(UserCreationForm):
    class Meta:
        model = User
        fields = ("email",)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["email"].widget.attrs.update({"autocomplete": "email"})
        self.fields["password1"].label = "Account password"
        self.fields["password1"].widget.attrs.update(
            {"autocomplete": "new-password", "minlength": 8}
        )
        self.fields["password2"].label = "Confirm account password"
        self.fields["password2"].widget.attrs.update({"autocomplete": "new-password"})


class ConnectionCodeRedeemForm(forms.Form):
    code = forms.CharField(
        max_length=64,
        label="Connection code",
        help_text="Paste the one-time code shared by the other person.",
    )

    def __init__(self, *args, user: User, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.connection_code: ConnectionCode | None = None

    def clean_code(self) -> str:
        code = self.cleaned_data["code"].strip().upper()

        try:
            connection_code = ConnectionCode.objects.select_related("created_by").get(
                code=code
            )
        except ConnectionCode.DoesNotExist as exc:
            raise forms.ValidationError("That connection code does not exist.") from exc

        if connection_code.created_by_id == self.user.id:
            raise forms.ValidationError("You cannot accept your own connection code.")

        if connection_code.used:
            raise forms.ValidationError("That connection code has already been used.")

        if connection_code.is_expired:
            raise forms.ValidationError("That connection code has expired.")

        duplicate_exists = (
            Contact.objects.filter(
                status=Contact.Status.ACCEPTED,
            )
            .filter(
                Q(user_a=self.user, user_b=connection_code.created_by)
                | Q(user_a=connection_code.created_by, user_b=self.user)
            )
            .exists()
        )
        if duplicate_exists:
            raise forms.ValidationError("You are already connected to this user.")

        if (
            CryptoIdentity.objects.filter(
                user_id__in=[self.user.id, connection_code.created_by_id]
            ).count()
            != 2
        ):
            raise forms.ValidationError(
                "Both users must finish encryption setup before connecting."
            )

        self.connection_code = connection_code
        return code
