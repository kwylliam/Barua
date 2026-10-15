import random
from datetime import datetime, timedelta

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils import timezone


def calculate_delivery_timestamp(now: datetime | None = None) -> datetime:
    """Choose and return the delivery time for a newly posted letter."""
    now = now or timezone.now()
    mode = settings.LETTER_DELAY_MODE
    if mode == "minutes":
        minimum, maximum = settings.LETTER_DELAY_MINUTES
        unit = "minutes"
    elif mode == "days":
        minimum, maximum = settings.LETTER_DELAY_DAYS
        unit = "days"
    else:
        raise ImproperlyConfigured(
            "LETTER_DELAY_MODE must be either 'minutes' or 'days'."
        )

    if (
        not isinstance(minimum, int)
        or not isinstance(maximum, int)
        or minimum < 1
        or minimum > maximum
    ):
        raise ImproperlyConfigured(
            f"LETTER_DELAY_{unit.upper()} must be an increasing positive integer range."
        )

    return now + timedelta(**{unit: random.randint(minimum, maximum)})
