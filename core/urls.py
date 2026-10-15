from django.contrib.auth import views as auth_views
from django.urls import path

from core.forms import EmailAuthenticationForm
from core.views import (
    ConnectionCodeCreateView,
    ConnectionCodeRedeemView,
    ContactKeyVerificationView,
    ContactRecipientKeyView,
    CryptoIdentityView,
    CryptoSetupView,
    DashboardView,
    LetterComposeView,
    LetterDownloadView,
    LetterEnvelopeView,
    LetterOpenedView,
    LetterReadView,
    SignUpView,
    home,
)

urlpatterns = [
    path("", home, name="home"),
    path(
        "login/",
        auth_views.LoginView.as_view(
            template_name="registration/login.html",
            authentication_form=EmailAuthenticationForm,
            redirect_authenticated_user=True,
        ),
        name="login",
    ),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("signup/", SignUpView.as_view(), name="signup"),
    path("crypto/setup/", CryptoSetupView.as_view(), name="crypto-setup"),
    path("crypto/identity/", CryptoIdentityView.as_view(), name="crypto-identity"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path(
        "connections/create/",
        ConnectionCodeCreateView.as_view(),
        name="create-connection-code",
    ),
    path(
        "connections/redeem/",
        ConnectionCodeRedeemView.as_view(),
        name="redeem-connection-code",
    ),
    path(
        "contacts/<int:pk>/verify-key/",
        ContactKeyVerificationView.as_view(),
        name="verify-contact-key",
    ),
    path(
        "contacts/recipient-key/<int:user_id>/",
        ContactRecipientKeyView.as_view(),
        name="recipient-key",
    ),
    path("letters/compose/", LetterComposeView.as_view(), name="compose-letter"),
    path(
        "letters/<int:pk>/read/",
        LetterReadView.as_view(),
        name="read-letter",
    ),
    path(
        "letters/<int:pk>/envelope/",
        LetterEnvelopeView.as_view(),
        name="letter-envelope",
    ),
    path(
        "letters/<int:pk>/opened/",
        LetterOpenedView.as_view(),
        name="letter-opened",
    ),
    path(
        "letters/<int:pk>/download/",
        LetterDownloadView.as_view(),
        name="download-letter",
    ),
]
