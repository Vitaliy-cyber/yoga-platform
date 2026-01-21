"""Refresh token storage model for secure token rotation."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


class RefreshToken(Base):
    """
    Stores refresh tokens for secure token rotation.

    Each refresh token is stored as a hash and associated with device/session info.
    When a refresh token is used, it is invalidated and a new one is issued.
    """

    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash = Column(String(64), unique=True, nullable=False, index=True)  # SHA-256 hash
    device_info = Column(String(200), nullable=True)  # User-Agent or device identifier
    ip_address = Column(String(45), nullable=True)  # IPv4 or IPv6 address
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    is_revoked = Column(Boolean, default=False, nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoke_reason = Column(String(100), nullable=True)

    # Relationship to user
    user = relationship("User", back_populates="refresh_tokens")

    # Indexes for efficient queries
    __table_args__ = (
        Index("ix_refresh_tokens_user_expires", "user_id", "expires_at"),
        Index("ix_refresh_tokens_revoked", "is_revoked"),
    )

    def __repr__(self):
        return f"<RefreshToken(id={self.id}, user_id={self.user_id}, revoked={self.is_revoked})>"
