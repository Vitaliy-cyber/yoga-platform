"""Auth audit log model for security event tracking."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


class AuthAuditLog(Base):
    """
    Stores authentication-related events for security auditing.

    Tracks login attempts, logouts, token refreshes, password changes,
    and other security-relevant actions.
    """

    __tablename__ = "auth_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    action = Column(String(50), nullable=False, index=True)  # login, logout, token_refresh, etc.
    ip_address = Column(String(45), nullable=True)  # IPv4 or IPv6
    user_agent = Column(String(500), nullable=True)
    success = Column(Boolean, default=True, nullable=False)
    error_message = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)  # Additional context as JSON
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Relationship to user (optional - may be null for failed login attempts)
    user = relationship("User", back_populates="auth_audit_logs")

    # Indexes for efficient queries
    __table_args__ = (
        Index("ix_auth_audit_user_action", "user_id", "action"),
        Index("ix_auth_audit_created_success", "created_at", "success"),
    )

    # Action constants
    ACTION_LOGIN = "login"
    ACTION_LOGOUT = "logout"
    ACTION_LOGOUT_ALL = "logout_all"
    ACTION_TOKEN_REFRESH = "token_refresh"
    ACTION_TOKEN_REVOKE = "token_revoke"
    ACTION_SESSION_REVOKE = "session_revoke"
    ACTION_PASSWORD_CHANGE = "password_change"
    ACTION_FAILED_LOGIN = "failed_login"
    ACTION_RATE_LIMITED = "rate_limited"

    def __repr__(self):
        return f"<AuthAuditLog(id={self.id}, user_id={self.user_id}, action='{self.action}', success={self.success})>"
