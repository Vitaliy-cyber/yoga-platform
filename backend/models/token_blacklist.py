"""Token blacklist model for invalidated JWT tokens."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.sql import func

from db.database import Base


class TokenBlacklist(Base):
    """
    Stores blacklisted JWT tokens (JTI - JWT ID).

    Used to invalidate tokens before their natural expiration,
    for example during logout or security incidents.
    """

    __tablename__ = "token_blacklist"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String(36), unique=True, nullable=False, index=True)  # JWT ID (UUID)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    token_type = Column(String(20), nullable=False, default="access")  # access or refresh
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    reason = Column(String(100), nullable=True)  # logout, security, revoked, etc.

    # Composite index for efficient cleanup queries
    __table_args__ = (
        Index("ix_token_blacklist_expires_at", "expires_at"),
        Index("ix_token_blacklist_user_id_type", "user_id", "token_type"),
    )

    def __repr__(self):
        return f"<TokenBlacklist(id={self.id}, jti='{self.jti[:8]}...', user_id={self.user_id})>"
