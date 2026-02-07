from db.database import Base
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


class Pose(Base):
    __tablename__ = "poses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        default=0,
        server_default="0",
    )
    code = Column(String(20), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    name_en = Column(String(200), nullable=True)
    category_id = Column(
        Integer,
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    description = Column(Text, nullable=True)
    effect = Column(Text, nullable=True)
    breathing = Column(Text, nullable=True)
    schema_path = Column(String(500), nullable=True)
    photo_path = Column(String(500), nullable=True)
    muscle_layer_path = Column(String(500), nullable=True)
    skeleton_layer_path = Column(String(500), nullable=True)
    # Optimistic locking: version number incremented on each update
    # Prevents lost updates when multiple users edit the same pose concurrently
    version = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (UniqueConstraint("user_id", "code", name="uq_pose_user_code"),)

    # SQLAlchemy optimistic concurrency control:
    # - Includes `version` in UPDATE statements and increments it automatically.
    # - Concurrent updates with the same base version raise StaleDataError.
    __mapper_args__ = {
        "version_id_col": version,
        "version_id_generator": lambda v: (v or 0) + 1,
    }

    # Зв'язки
    user = relationship("User", back_populates="poses")
    category = relationship("Category", back_populates="poses")
    pose_muscles = relationship(
        "PoseMuscle", back_populates="pose", cascade="all, delete-orphan"
    )
    sequence_poses = relationship(
        "SequencePose", back_populates="pose", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Pose(id={self.id}, code='{self.code}', name='{self.name}')>"


class PoseMuscle(Base):
    __tablename__ = "pose_muscles"

    # Adding index=True on foreign key columns for faster lookups and JOINs
    # These indexes improve performance for:
    # - Fetching all muscles for a pose (pose_id index)
    # - Fetching all poses that use a muscle (muscle_id index)
    # - DELETE operations when removing pose_muscles by pose_id
    pose_id = Column(
        Integer,
        ForeignKey("poses.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    muscle_id = Column(
        Integer,
        ForeignKey("muscles.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    activation_level = Column(Integer, nullable=False, default=50)

    __table_args__ = (
        CheckConstraint(
            "activation_level >= 0 AND activation_level <= 100",
            name="check_activation_level",
        ),
    )

    # Зв'язки
    pose = relationship("Pose", back_populates="pose_muscles")
    muscle = relationship("Muscle", back_populates="pose_muscles")

    def __repr__(self):
        return f"<PoseMuscle(pose_id={self.pose_id}, muscle_id={self.muscle_id}, activation={self.activation_level})>"
