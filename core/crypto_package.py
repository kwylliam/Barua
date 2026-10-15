import json
from typing import Any

from django.core.exceptions import ValidationError

KEY_PACKAGE_VERSION = 1
MAX_PACKAGE_BYTES = 512 * 1024

TOP_LEVEL_FIELDS = {
    "format_version",
    "key_id",
    "encryption_public_key",
    "signing_public_key",
    "fingerprint",
    "encrypted_private_bundle",
    "recovery_wrap",
}
ACCOUNT_PASSWORD_FIELD = "account_wrap"
LEGACY_PASSPHRASE_FIELD = "passphrase_wrap"

ENCRYPTED_FIELDS = {"algorithm", "ciphertext", "nonce"}
WRAP_FIELDS = ENCRYPTED_FIELDS | {"purpose", "salt", "kdf", "kdf_parameters"}


def validate_key_package(package: Any) -> dict[str, Any]:
    if not isinstance(package, dict):
        raise ValidationError("The key package must be a JSON object.")

    try:
        encoded_size = len(json.dumps(package, separators=(",", ":")))
    except (TypeError, ValueError) as exc:
        raise ValidationError("The key package must contain JSON values.") from exc

    if encoded_size > MAX_PACKAGE_BYTES:
        raise ValidationError("The key package is too large.")

    package_fields = set(package)
    if package_fields not in (
        TOP_LEVEL_FIELDS,
        TOP_LEVEL_FIELDS | {ACCOUNT_PASSWORD_FIELD},
        TOP_LEVEL_FIELDS | {LEGACY_PASSPHRASE_FIELD},
        TOP_LEVEL_FIELDS | {ACCOUNT_PASSWORD_FIELD, LEGACY_PASSPHRASE_FIELD},
    ):
        raise ValidationError("The key package has an unsupported shape.")

    if package["format_version"] != KEY_PACKAGE_VERSION:
        raise ValidationError("Unsupported key package version.")

    for field in (
        "key_id",
        "encryption_public_key",
        "signing_public_key",
        "fingerprint",
    ):
        if not isinstance(package[field], str) or not package[field]:
            raise ValidationError(f"Key package field '{field}' must be a string.")

    _validate_nested_fields(package["encrypted_private_bundle"], ENCRYPTED_FIELDS)
    if ACCOUNT_PASSWORD_FIELD in package:
        _validate_nested_fields(package[ACCOUNT_PASSWORD_FIELD], WRAP_FIELDS)
    if LEGACY_PASSPHRASE_FIELD in package:
        _validate_nested_fields(package[LEGACY_PASSPHRASE_FIELD], WRAP_FIELDS)
    _validate_nested_fields(package["recovery_wrap"], WRAP_FIELDS)
    return package


def _validate_nested_fields(value: Any, expected_fields: set[str]) -> None:
    if not isinstance(value, dict) or set(value) != expected_fields:
        raise ValidationError(
            "The key package contains an unsupported encrypted section."
        )
