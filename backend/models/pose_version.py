"""
PoseVersion model for tracking pose history and changes.

Each version stores a snapshot of the pose data at the time of modification,
allowing for complete history tracking and version restoration.
"""

from db.database import Base
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


class PoseVersion(Base):
    """
    Stores versioned snapshots of Pose data for history tracking.

    Each time a pose is updated, a new PoseVersion record is created
    containing the state of the pose before the update.
    """
    __tablename__ = "pose_versions"

    # Composite unique index to prevent duplicate version numbers per pose
    # This enforces data integrity at the database level
    __table_args__ = (
        Index(
            'ix_pose_versions_pose_version',
            'pose_id',
            'version_number',
            unique=True
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    pose_id = Column(
        Integer,
        ForeignKey("poses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number = Column(Integer, nullable=False)

    # Snapshot of pose data at this version
    name = Column(String(200), nullable=False)
    name_en = Column(String(200), nullable=True)
    code = Column(String(20), nullable=False)
    category_id = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)
    effect = Column(Text, nullable=True)
    breathing = Column(Text, nullable=True)

    # Image paths at this version
    schema_path = Column(Text, nullable=True)
    photo_path = Column(Text, nullable=True)
    muscle_layer_path = Column(Text, nullable=True)
    skeleton_layer_path = Column(Text, nullable=True)

    # Muscles snapshot as JSON (list of {muscle_id, muscle_name, activation_level})
    muscles_json = Column(Text, nullable=True)

    # Metadata
    change_note = Column(Text, nullable=True)  # User's description of changes
    changed_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    pose = relationship("Pose", backref="versions")
    changed_by = relationship("User")

    def __repr__(self):
        return f"<PoseVersion(id={self.id}, pose_id={self.pose_id}, version={self.version_number})>"
