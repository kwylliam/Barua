from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from core.models import ConnectionCode, Contact, CryptoIdentity, Letter, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ("email",)
    list_display = ("email", "is_staff", "is_superuser", "created_at")
    search_fields = ("email",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Important dates", {"fields": ("last_login", "created_at")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "password1",
                    "password2",
                    "is_staff",
                    "is_superuser",
                ),
            },
        ),
    )
    readonly_fields = ("created_at",)


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ("user_a", "user_b", "status", "created_at")
    search_fields = ("user_a__email", "user_b__email")
    readonly_fields = ("created_at",)


@admin.register(CryptoIdentity)
class CryptoIdentityAdmin(admin.ModelAdmin):
    list_display = ("user", "key_id", "fingerprint", "created_at", "updated_at")
    search_fields = ("user__email", "key_id", "fingerprint")
    readonly_fields = (
        "user",
        "key_id",
        "encryption_public_key",
        "signing_public_key",
        "fingerprint",
        "key_package",
        "created_at",
        "updated_at",
    )


@admin.register(ConnectionCode)
class ConnectionCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "created_by", "expires_at", "used")
    list_filter = ("used",)
    search_fields = ("code", "created_by__email")


@admin.register(Letter)
class LetterAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "sender",
        "recipient",
        "delivery_timestamp",
        "downloaded",
        "deletion_timestamp",
    )
    list_filter = ("downloaded",)
    search_fields = ("sender__email", "recipient__email")
