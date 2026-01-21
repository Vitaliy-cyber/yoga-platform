"""Sequence models for yoga pose sequences/complexes."""

from db.database import Base
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum


class DifficultyLevel(enum.Enum):
    """Difficulty levels for sequences."""
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class Sequence(Base):
    """A sequence/complex of yoga poses."""
    __tablename__ = "sequences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    duration_seconds = Column(Integer, nullable=True)  # Total duration
    difficulty = Column(
        Enum(DifficultyLevel),
        nullable=False,
        default=DifficultyLevel.BEGINNER
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user = relationship("User", back_populates="sequences")
    sequence_poses = relationship(
        "SequencePose",
        back_populates="sequence",
        cascade="all, delete-orphan",
        order_by="SequencePose.order_index"
    )

    def __repr__(self):
        return f"<Sequence(id={self.id}, name='{self.name}')>"


class SequencePose(Base):
    """A pose within a sequence with order and duration."""
    __tablename__ = "sequence_poses"

    id = Column(Integer, primary_key=True, index=True)
    sequence_id = Column(
        Integer, ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pose_id = Column(
        Integer, ForeignKey("poses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_index = Column(Integer, nullable=False, default=0)
    duration_seconds = Column(Integer, nullable=False, default=30)  # Default 30 seconds per pose
    transition_note = Column(Text, nullable=True)  # Notes for transitioning to this pose

    __table_args__ = (
        CheckConstraint(
            "duration_seconds > 0",
            name="check_duration_positive",
        ),
        CheckConstraint(
            "order_index >= 0",
            name="check_order_index_non_negative",
        ),
        UniqueConstraint(
            "sequence_id",
            "order_index",
            name="uq_sequence_pose_order",
        ),
    )

    # Relationships
    sequence = relationship("Sequence", back_populates="sequence_poses")
    pose = relationship("Pose", back_populates="sequence_poses")

    def __repr__(self):
        return f"<SequencePose(id={self.id}, sequence_id={self.sequence_id}, pose_id={self.pose_id}, order={self.order_index})>"
