from db.database import Base
from sqlalchemy import Column, DateTime, Integer, String, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


class GenerationTask(Base):
    __tablename__ = "generation_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(36), nullable=False, unique=True, index=True)  # UUID
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Status
    status = Column(
        String(20), nullable=False, default="pending"
    )  # pending, processing, completed, failed
    progress = Column(Integer, nullable=False, default=0)
    status_message = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)

    # Results
    photo_url = Column(Text, nullable=True)
    muscles_url = Column(Text, nullable=True)
    quota_warning = Column(Boolean, nullable=False, default=False)
    # Analyzed muscles as JSON: [{"name": "quadriceps", "activation_level": 85}, ...]
    analyzed_muscles_json = Column(Text, nullable=True)
    # User's additional notes/instructions for AI generation
    additional_notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    user = relationship("User", back_populates="generation_tasks")

    def __repr__(self):
        return f"<GenerationTask(task_id='{self.task_id}', status='{self.status}')>"
