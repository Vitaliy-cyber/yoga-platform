from db.database import Base
from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


class Muscle(Base):
    __tablename__ = "muscles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    name_ua = Column(String(100), nullable=True)
    body_part = Column(String(50), nullable=True)  # 'back', 'arms', 'legs', 'core', 'chest', 'shoulders'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Зв'язки
    pose_muscles = relationship("PoseMuscle", back_populates="muscle", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Muscle(id={self.id}, name='{self.name}')>"
