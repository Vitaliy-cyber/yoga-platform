"""Add pose_versions table for version history tracking

Revision ID: 20260120125346
Revises: 20260120115719
Create Date: 2026-01-20 12:53:46

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260120125346'
down_revision: Union[str, None] = '20260120115719'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create pose_versions table for tracking pose history."""
    op.create_table(
        'pose_versions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('pose_id', sa.Integer(), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        # Snapshot of pose data
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('name_en', sa.String(200), nullable=True),
        sa.Column('code', sa.String(20), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('effect', sa.Text(), nullable=True),
        sa.Column('breathing', sa.Text(), nullable=True),
        # Image paths
        sa.Column('schema_path', sa.Text(), nullable=True),
        sa.Column('photo_path', sa.Text(), nullable=True),
        sa.Column('muscle_layer_path', sa.Text(), nullable=True),
        sa.Column('skeleton_layer_path', sa.Text(), nullable=True),
        # Muscles JSON
        sa.Column('muscles_json', sa.Text(), nullable=True),
        # Metadata
        sa.Column('change_note', sa.Text(), nullable=True),
        sa.Column('changed_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        # Constraints
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['pose_id'], ['poses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['changed_by_id'], ['users.id'], ondelete='SET NULL'),
    )
    # Create indexes for efficient queries
    op.create_index('ix_pose_versions_id', 'pose_versions', ['id'], unique=False)
    op.create_index('ix_pose_versions_pose_id', 'pose_versions', ['pose_id'], unique=False)
    op.create_index('ix_pose_versions_changed_by_id', 'pose_versions', ['changed_by_id'], unique=False)
    # Composite index for efficient version lookup
    op.create_index(
        'ix_pose_versions_pose_version',
        'pose_versions',
        ['pose_id', 'version_number'],
        unique=True
    )


def downgrade() -> None:
    """Drop pose_versions table."""
    op.drop_index('ix_pose_versions_pose_version', table_name='pose_versions')
    op.drop_index('ix_pose_versions_changed_by_id', table_name='pose_versions')
    op.drop_index('ix_pose_versions_pose_id', table_name='pose_versions')
    op.drop_index('ix_pose_versions_id', table_name='pose_versions')
    op.drop_table('pose_versions')
