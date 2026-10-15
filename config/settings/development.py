from .base import *

DEBUG = True
LETTER_DELAY_MODE = "minutes"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}
