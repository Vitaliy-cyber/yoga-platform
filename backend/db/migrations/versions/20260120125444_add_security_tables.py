"""Add security tables for rate limiting and token management

Revision ID: 20260120125444
Revises: 20260120115719
Create Date: 2026-01-20 12:54:44

This migration adds:
- token_blacklist: For storing invalidated JWT tokens
- refresh_tokens: For storing refresh token hashes and session info
- auth_audit_logs: For tracking authentication events
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260120125444'
down_revision: Union[str, None] = '20260120115719'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add security-related tables."""

    # Create token_blacklist table
    op.create_table(
        'token_blacklist',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('jti', sa.String(36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('token_type', sa.String(20), nullable=False, server_default='access'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('reason', sa.String(100), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_token_blacklist_id', 'token_blacklist', ['id'])
    op.create_index('ix_token_blacklist_jti', 'token_blacklist', ['jti'], unique=True)
    op.create_index('ix_token_blacklist_expires_at', 'token_blacklist', ['expires_at'])
    op.create_index('ix_token_blacklist_user_id_type', 'token_blacklist', ['user_id', 'token_type'])

    # Create refresh_tokens table
    op.create_table(
        'refresh_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False),
        sa.Column('device_info', sa.String(200), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_revoked', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoke_reason', sa.String(100), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_refresh_tokens_id', 'refresh_tokens', ['id'])
    op.create_index('ix_refresh_tokens_user_id', 'refresh_tokens', ['user_id'])
    op.create_index('ix_refresh_tokens_token_hash', 'refresh_tokens', ['token_hash'], unique=True)
    op.create_index('ix_refresh_tokens_user_expires', 'refresh_tokens', ['user_id', 'expires_at'])
    op.create_index('ix_refresh_tokens_revoked', 'refresh_tokens', ['is_revoked'])

    # Create auth_audit_logs table
    op.create_table(
        'auth_audit_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.String(500), nullable=True),
        sa.Column('success', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('metadata_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_auth_audit_logs_id', 'auth_audit_logs', ['id'])
    op.create_index('ix_auth_audit_logs_user_id', 'auth_audit_logs', ['user_id'])
    op.create_index('ix_auth_audit_logs_action', 'auth_audit_logs', ['action'])
    op.create_index('ix_auth_audit_logs_created_at', 'auth_audit_logs', ['created_at'])
    op.create_index('ix_auth_audit_user_action', 'auth_audit_logs', ['user_id', 'action'])
    op.create_index('ix_auth_audit_created_success', 'auth_audit_logs', ['created_at', 'success'])


def downgrade() -> None:
    """Remove security-related tables."""

    # Drop auth_audit_logs table
    op.drop_index('ix_auth_audit_created_success', table_name='auth_audit_logs')
    op.drop_index('ix_auth_audit_user_action', table_name='auth_audit_logs')
    op.drop_index('ix_auth_audit_logs_created_at', table_name='auth_audit_logs')
    op.drop_index('ix_auth_audit_logs_action', table_name='auth_audit_logs')
    op.drop_index('ix_auth_audit_logs_user_id', table_name='auth_audit_logs')
    op.drop_index('ix_auth_audit_logs_id', table_name='auth_audit_logs')
    op.drop_table('auth_audit_logs')

    # Drop refresh_tokens table
    op.drop_index('ix_refresh_tokens_revoked', table_name='refresh_tokens')
    op.drop_index('ix_refresh_tokens_user_expires', table_name='refresh_tokens')
    op.drop_index('ix_refresh_tokens_token_hash', table_name='refresh_tokens')
    op.drop_index('ix_refresh_tokens_user_id', table_name='refresh_tokens')
    op.drop_index('ix_refresh_tokens_id', table_name='refresh_tokens')
    op.drop_table('refresh_tokens')

    # Drop token_blacklist table
    op.drop_index('ix_token_blacklist_user_id_type', table_name='token_blacklist')
    op.drop_index('ix_token_blacklist_expires_at', table_name='token_blacklist')
    op.drop_index('ix_token_blacklist_jti', table_name='token_blacklist')
    op.drop_index('ix_token_blacklist_id', table_name='token_blacklist')
    op.drop_table('token_blacklist')
