from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from core.models import Letter


class Command(BaseCommand):
    help = "Delete encrypted letter envelopes past their retention period."

    def handle(self, *args, **options):
        now = timezone.now()
        max_age_cutoff = now - timedelta(days=settings.LETTER_MAX_RETENTION_DAYS)
        expired_letters = Letter.objects.filter(
            Q(deletion_timestamp__lte=now)
            | Q(
                deletion_timestamp__isnull=True,
                delivery_timestamp__lte=max_age_cutoff,
            )
        )

        deleted_count = 0
        for letter in expired_letters.iterator():
            letter.encrypted_file.delete(save=False)
            letter.delete()
            deleted_count += 1

        self.stdout.write(f"Deleted {deleted_count} expired letter(s).")
