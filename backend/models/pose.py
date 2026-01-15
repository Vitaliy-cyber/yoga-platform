from db.database import Base
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


class Pose(Base):
    __tablename__ = "poses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Зв'язки
    user = relationship("User", back_populates="poses")
    category = relationship("Category", back_populates="poses")
    pose_muscles = relationship(
        "PoseMuscle", back_populates="pose", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Pose(id={self.id}, code='{self.code}', name='{self.name}')>"


class PoseMuscle(Base):
    __tablename__ = "pose_muscles"

    pose_id = Column(
        Integer, ForeignKey("poses.id", ondelete="CASCADE"), primary_key=True
    )
    muscle_id = Column(
        Integer, ForeignKey("muscles.id", ondelete="CASCADE"), primary_key=True
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
