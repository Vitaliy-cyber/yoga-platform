"""Add analyzed_muscles_json column to generation_tasks

Revision ID: 20260120115719
Revises:
Create Date: 2026-01-20 11:57:19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260120115719'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add analyzed_muscles_json column to store AI-analyzed muscles data."""
    op.add_column(
        'generation_tasks',
        sa.Column('analyzed_muscles_json', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    """Remove analyzed_muscles_json column."""
    op.drop_column('generation_tasks', 'analyzed_muscles_json')
