import hashlib

from db.database import Base
from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


def hash_user_token(token: str) -> str:
    """
    Hash a user token for secure storage.

    Uses SHA-256 which is appropriate for tokens (not passwords) because:
    - Tokens are high-entropy random strings, not user-chosen passwords
    - No need for salting since tokens are unique and random
    - Fast hashing is acceptable for high-entropy secrets
    """
    return hashlib.sha256(token.encode()).hexdigest()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    # SECURITY: token_hash stores the SHA-256 hash of the user's token.
    # The raw token should never be stored in the database.
    # When authenticating, hash the provided token and compare against this field.
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    name = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    poses = relationship("Pose", back_populates="user", cascade="all, delete-orphan")
    categories = relationship(
        "Category", back_populates="user", cascade="all, delete-orphan"
    )
    sequences = relationship(
        "Sequence", back_populates="user", cascade="all, delete-orphan"
    )
    generation_tasks = relationship(
        "GenerationTask", back_populates="user", cascade="all, delete-orphan"
    )
    refresh_tokens = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )
    auth_audit_logs = relationship(
        "AuthAuditLog", back_populates="user"
    )

    def __repr__(self):
        return f"<User(id={self.id}, token_hash='{self.token_hash[:8]}...')>"

    @classmethod
    def create_with_token(cls, token: str, **kwargs) -> "User":
        """
        Factory method to create a User with a hashed token.

        Args:
            token: The raw user token to hash and store
            **kwargs: Additional User fields (name, etc.)

        Returns:
            A new User instance with the token_hash set
        """
        return cls(token_hash=hash_user_token(token), **kwargs)

    def verify_token(self, token: str) -> bool:
        """
        Verify a token against the stored hash.

        Args:
            token: The raw token to verify

        Returns:
            True if the token matches, False otherwise
        """
        return self.token_hash == hash_user_token(token)
