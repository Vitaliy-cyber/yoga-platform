from db.database import Base
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship


class Muscle(Base):
    __tablename__ = "muscles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    name_ua = Column(String(100), nullable=True)
    body_part = Column(String(50), nullable=True)  # 'back', 'arms', 'legs', 'core', 'chest', 'shoulders'
    body_part = Column(
        String(50), nullable=True
    )  # 'back', 'arms', 'legs', 'core', 'chest', 'shoulders'
    # Зв'язки
    pose_muscles = relationship("PoseMuscle", back_populates="muscle")

    def __repr__(self):
        return f"<Muscle(id={self.id}, name='{self.name}')>"
