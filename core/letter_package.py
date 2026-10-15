import json
import re
from typing import Any

from django.core.exceptions import ValidationError

LETTER_FORMAT_VERSION = 1
LETTER_ALGORITHM = "xchacha20poly1305-ietf"
MAX_LETTER_PACKAGE_BYTES = 20 * 1024 * 1024

LETTER_FIELDS = {
    "format_version",
    "algorithm",
    "letter_id",
    "sender_key_id",
    "recipient_key_id",
    "ciphertext",
    "nonce",
    "wrapped_content_key",
    "signature",
}
LETTER_ID_FIELDS = {"letter_id", "sender_key_id", "recipient_key_id"}
SAFE_ENCODED_VALUE = re.compile(r"^[A-Za-z0-9_-]+$")


def validate_letter_package(package: Any) -> dict[str, Any]:
    if not isinstance(package, dict):
        raise ValidationError("The letter package must be a JSON object.")

    try:
        encoded_size = len(json.dumps(package, separators=(",", ":")))
    except (TypeError, ValueError) as exc:
        raise ValidationError("The letter package must contain JSON values.") from exc

    if encoded_size > MAX_LETTER_PACKAGE_BYTES:
        raise ValidationError("The letter package is too large.")

    if set(package) != LETTER_FIELDS:
        raise ValidationError("The letter package has an unsupported shape.")

    if package["format_version"] != LETTER_FORMAT_VERSION:
        raise ValidationError("Unsupported letter package version.")

    if package["algorithm"] != LETTER_ALGORITHM:
        raise ValidationError("Unsupported letter encryption algorithm.")

    for field in LETTER_FIELDS - {"format_version", "algorithm"}:
        value = package[field]
        if (
            not isinstance(value, str)
            or not value
            or len(value)
            > (128 if field in LETTER_ID_FIELDS else MAX_LETTER_PACKAGE_BYTES)
            or not SAFE_ENCODED_VALUE.fullmatch(value)
        ):
            raise ValidationError(
                f"Letter package field '{field}' must be a string "
                f"(received JSON type: {type(value).__name__})."
            )

    return package
