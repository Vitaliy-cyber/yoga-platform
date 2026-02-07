"""Merge pose-versions and security migration heads.

Revision ID: 20260205183000
Revises: 20260120125346, 20260120125444
Create Date: 2026-02-05 18:30:00
"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "20260205183000"
down_revision: Union[str, Sequence[str], None] = ("20260120125346", "20260120125444")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge heads only."""
    pass


def downgrade() -> None:
    """Split heads only."""
    pass
