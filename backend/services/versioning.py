"""
Versioning service for managing pose history and version control.

Provides functionality for:
- Creating version snapshots before pose updates
- Retrieving version history
- Restoring poses to previous versions
- Comparing differences between versions
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from models.pose import Pose, PoseMuscle
from models.pose_version import PoseVersion
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

# Maximum number of versions to keep per pose
MAX_VERSIONS_PER_POSE = 50

# Minimum versions to always keep (including baseline version 1)
MIN_VERSIONS_TO_KEEP = 5


@dataclass
class RestoreResult:
    """Result of a version restore operation with optional warnings."""
    pose: Pose
    warnings: List[str] = field(default_factory=list)
    missing_muscles: List[Dict[str, Any]] = field(default_factory=list)


class VersioningService:
    """Service for managing pose version history."""

    # Fields to compare for detecting changes
    VERSIONED_FIELDS = [
        "name",
        "name_en",
        "code",
        "category_id",
        "description",
        "effect",
        "breathing",
        "schema_path",
        "photo_path",
        "muscle_layer_path",
        "skeleton_layer_path",
    ]

    @staticmethod
    def _serialize_muscles(pose: Pose) -> str:
        """Serialize pose muscles to JSON string."""
        muscles_data = []
        for pm in pose.pose_muscles:
            muscle_entry = {
                "muscle_id": pm.muscle_id,
                "muscle_name": pm.muscle.name if pm.muscle else None,
                "muscle_name_ua": pm.muscle.name_ua if pm.muscle else None,
                "body_part": pm.muscle.body_part if pm.muscle else None,
                "activation_level": pm.activation_level,
            }
            muscles_data.append(muscle_entry)
        return json.dumps(muscles_data, ensure_ascii=False)

    @staticmethod
    def _deserialize_muscles(muscles_json: Optional[str]) -> Tuple[List[Dict[str, Any]], bool]:
        """
        Deserialize muscles from JSON string.

        Returns:
            Tuple of (muscles_list, is_valid) - is_valid is False if JSON was corrupted
        """
        if not muscles_json:
            return [], True
        try:
            data = json.loads(muscles_json)
            if not isinstance(data, list):
                logger.error(f"muscles_json is not a list: {type(data)}")
                return [], False
            return data, True
        except json.JSONDecodeError as e:
            logger.error(f"Failed to deserialize muscles_json: {e}")
            return [], False

    @staticmethod
    def _poses_are_equal(pose: Pose, version: PoseVersion) -> bool:
        """
        Compare pose current state with a version to detect changes.
        Returns True if no meaningful changes occurred.

        Uses semantic comparison for muscles (by muscle_id and activation_level)
        to avoid false positives from JSON serialization order differences.
        """
        for field_name in VersioningService.VERSIONED_FIELDS:
            pose_value = getattr(pose, field_name, None)
            version_value = getattr(version, field_name, None)
            if pose_value != version_value:
                return False

        # Compare muscles semantically (not string comparison)
        # This fixes the empty muscles serialization bug where [] != "[]"
        current_muscles_map = {
            pm.muscle_id: pm.activation_level
            for pm in pose.pose_muscles
        }

        version_muscles, is_valid = VersioningService._deserialize_muscles(version.muscles_json)
        if not is_valid:
            # If version muscles are corrupted, consider them different
            return False

        version_muscles_map = {
            m.get("muscle_id"): m.get("activation_level")
            for m in version_muscles
            if m.get("muscle_id") is not None
        }

        return current_muscles_map == version_muscles_map

    @staticmethod
    def _pose_has_changes(
        pose: Pose,
        db: AsyncSession,
        new_muscles_json: Optional[str] = None
    ) -> bool:
        """
        Check if pose has any actual changes compared to stored version data.
        Used to determine if we should create a new version.
        """
        current_muscles = new_muscles_json or VersioningService._serialize_muscles(pose)
        # If we have previous state stored, compare - otherwise always consider changed
        return True

    async def get_next_version_number(
        self,
        db: AsyncSession,
        pose_id: int
    ) -> int:
        """
        Get the next version number for a pose.

        Note: We don't use FOR UPDATE here because PostgreSQL doesn't allow
        FOR UPDATE with aggregate functions (func.max). Race conditions are
        handled by the transaction isolation level and the fact that the
        calling code should be updating within the same transaction.
        """
        result = await db.execute(
            select(func.max(PoseVersion.version_number))
            .where(PoseVersion.pose_id == pose_id)
        )
        max_version = result.scalar()
        return (max_version or 0) + 1

    async def create_version(
        self,
        db: AsyncSession,
        pose: Pose,
        user_id: int,
        change_note: Optional[str] = None,
        check_for_changes: bool = True
    ) -> Optional[PoseVersion]:
        """
        Create a version snapshot of the current pose state.

        Args:
            db: Database session
            pose: The pose to create a version for
            user_id: ID of the user making the change
            change_note: Optional description of what changed
            check_for_changes: If True, skip version creation if nothing changed

        Returns:
            Created PoseVersion or None if skipped
        """
        # Ensure pose muscles are loaded
        if not pose.pose_muscles:
            await db.refresh(pose, ["pose_muscles"])
            # Also load the muscle relationships
            for pm in pose.pose_muscles:
                if pm.muscle is None:
                    await db.refresh(pm, ["muscle"])

        # Get the latest version to compare
        if check_for_changes:
            latest_version = await self.get_latest_version(db, pose.id)
            if latest_version and self._poses_are_equal(pose, latest_version):
                logger.debug(f"Skipping version creation for pose {pose.id}: no changes")
                return None

        version_number = await self.get_next_version_number(db, pose.id)

        # Serialize muscles
        muscles_json = self._serialize_muscles(pose)

        # Create version snapshot
        version = PoseVersion(
            pose_id=pose.id,
            version_number=version_number,
            name=pose.name,
            name_en=pose.name_en,
            code=pose.code,
            category_id=pose.category_id,
            description=pose.description,
            effect=pose.effect,
            breathing=pose.breathing,
            schema_path=pose.schema_path,
            photo_path=pose.photo_path,
            muscle_layer_path=pose.muscle_layer_path,
            skeleton_layer_path=pose.skeleton_layer_path,
            muscles_json=muscles_json,
            change_note=change_note,
            changed_by_id=user_id,
        )

        db.add(version)
        await db.flush()

        # Clean up old versions if exceeding limit
        await self._cleanup_old_versions(db, pose.id)

        logger.info(f"Created version {version_number} for pose {pose.id}")
        return version

    async def _cleanup_old_versions(
        self,
        db: AsyncSession,
        pose_id: int
    ) -> int:
        """
        Remove oldest versions if exceeding MAX_VERSIONS_PER_POSE.

        IMPORTANT: Never deletes version 1 (the baseline version) and always
        keeps at least MIN_VERSIONS_TO_KEEP versions for data safety.

        Returns the number of versions deleted.
        """
        # Get all versions ordered by version_number desc
        result = await db.execute(
            select(PoseVersion)
            .where(PoseVersion.pose_id == pose_id)
            .order_by(PoseVersion.version_number.desc())
        )
        versions = list(result.scalars().all())

        if len(versions) <= MAX_VERSIONS_PER_POSE:
            return 0

        # Determine how many we can delete while keeping minimums
        # We keep at least MIN_VERSIONS_TO_KEEP versions
        versions_to_keep = max(MAX_VERSIONS_PER_POSE, MIN_VERSIONS_TO_KEEP)
        if len(versions) <= versions_to_keep:
            return 0

        # Get candidates for deletion (oldest versions beyond the limit)
        deletion_candidates = versions[MAX_VERSIONS_PER_POSE:]

        deleted_count = 0
        for version in deletion_candidates:
            # NEVER delete version 1 - it's the baseline/initial version
            if version.version_number == 1:
                logger.debug(f"Skipping deletion of baseline version 1 for pose {pose_id}")
                continue

            await db.delete(version)
            deleted_count += 1

        if deleted_count > 0:
            logger.info(f"Cleaned up {deleted_count} old versions for pose {pose_id}")

        return deleted_count

    async def get_latest_version(
        self,
        db: AsyncSession,
        pose_id: int
    ) -> Optional[PoseVersion]:
        """Get the most recent version for a pose."""
        result = await db.execute(
            select(PoseVersion)
            .where(PoseVersion.pose_id == pose_id)
            .order_by(PoseVersion.version_number.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_versions(
        self,
        db: AsyncSession,
        pose_id: int,
        skip: int = 0,
        limit: int = 50
    ) -> List[PoseVersion]:
        """
        Get all versions for a pose ordered by version_number descending.

        Args:
            db: Database session
            pose_id: The pose ID
            skip: Number of versions to skip (pagination)
            limit: Maximum number of versions to return

        Returns:
            List of PoseVersion objects
        """
        result = await db.execute(
            select(PoseVersion)
            .options(selectinload(PoseVersion.changed_by))
            .where(PoseVersion.pose_id == pose_id)
            .order_by(PoseVersion.version_number.desc())
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_version(
        self,
        db: AsyncSession,
        pose_id: int,
        version_id: int
    ) -> Optional[PoseVersion]:
        """Get a specific version by ID."""
        result = await db.execute(
            select(PoseVersion)
            .options(selectinload(PoseVersion.changed_by))
            .where(
                PoseVersion.id == version_id,
                PoseVersion.pose_id == pose_id
            )
        )
        return result.scalar_one_or_none()

    async def get_version_by_number(
        self,
        db: AsyncSession,
        pose_id: int,
        version_number: int
    ) -> Optional[PoseVersion]:
        """Get a version by its version number."""
        result = await db.execute(
            select(PoseVersion)
            .options(selectinload(PoseVersion.changed_by))
            .where(
                PoseVersion.pose_id == pose_id,
                PoseVersion.version_number == version_number
            )
        )
        return result.scalar_one_or_none()

    async def restore_version(
        self,
        db: AsyncSession,
        pose_id: int,
        version_id: int,
        user_id: int,
        change_note: Optional[str] = None
    ) -> Optional[RestoreResult]:
        """
        Restore a pose to a specific version.

        This creates a new version with the current state before restoring,
        then applies the old version's data to the pose.

        IMPORTANT: This method validates muscles_json BEFORE deleting current
        muscles to prevent data loss from corrupted JSON.

        Args:
            db: Database session
            pose_id: The pose ID
            version_id: The version ID to restore to
            user_id: ID of the user performing the restore
            change_note: Optional note (will default to "Restored from vN")

        Returns:
            RestoreResult with pose and any warnings, or None if version not found
        """
        from models.muscle import Muscle

        warnings: List[str] = []
        missing_muscles: List[Dict[str, Any]] = []

        # Get the version to restore
        version = await self.get_version(db, pose_id, version_id)
        if not version:
            return None

        # CRITICAL: Validate muscles_json BEFORE any destructive operations
        # This prevents data loss if the JSON is corrupted
        muscles_data, is_valid = self._deserialize_muscles(version.muscles_json)
        if not is_valid:
            logger.error(
                f"Cannot restore pose {pose_id} to version {version_id}: "
                f"corrupted muscles_json"
            )
            raise ValueError(
                f"Cannot restore: version {version.version_number} has corrupted "
                f"muscle data. Aborting to prevent data loss."
            )

        # Get the current pose with relationships and lock it to prevent concurrent restores
        # Using with_for_update() to prevent race conditions
        result = await db.execute(
            select(Pose)
            .options(
                selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle)
            )
            .where(Pose.id == pose_id)
            .with_for_update()
        )
        pose = result.scalar_one_or_none()
        if not pose:
            return None

        # Create a version of the current state before restoring
        restore_note = change_note or f"Restored from v{version.version_number}"
        await self.create_version(
            db, pose, user_id,
            change_note=f"Before restore: {restore_note}",
            check_for_changes=False
        )

        # Restore pose fields from version
        pose.name = version.name
        pose.name_en = version.name_en
        pose.code = version.code
        pose.category_id = version.category_id
        pose.description = version.description
        pose.effect = version.effect
        pose.breathing = version.breathing
        pose.schema_path = version.schema_path
        pose.photo_path = version.photo_path
        pose.muscle_layer_path = version.muscle_layer_path
        pose.skeleton_layer_path = version.skeleton_layer_path

        # Restore muscles
        # First, delete existing pose muscles (safe now that we validated the JSON)
        for pm in pose.pose_muscles:
            await db.delete(pm)

        # Then, recreate from version's muscles_json
        for muscle_entry in muscles_data:
            muscle_id = muscle_entry.get("muscle_id")
            activation_level = muscle_entry.get("activation_level", 50)

            if muscle_id:
                # Clamp activation_level to valid range (0-100)
                if not isinstance(activation_level, (int, float)):
                    activation_level = 50
                    warnings.append(
                        f"Invalid activation_level for muscle {muscle_id}, "
                        f"defaulted to 50"
                    )
                activation_level = max(0, min(100, int(activation_level)))

                # Verify muscle exists
                muscle_result = await db.execute(
                    select(Muscle).where(Muscle.id == muscle_id)
                )
                muscle = muscle_result.scalar_one_or_none()
                if muscle:
                    pose_muscle = PoseMuscle(
                        pose_id=pose.id,
                        muscle_id=muscle_id,
                        activation_level=activation_level,
                    )
                    db.add(pose_muscle)
                else:
                    # Log warning for missing muscle - don't silently skip
                    missing_info = {
                        "muscle_id": muscle_id,
                        "muscle_name": muscle_entry.get("muscle_name"),
                        "activation_level": activation_level,
                    }
                    missing_muscles.append(missing_info)
                    logger.warning(
                        f"Muscle {muscle_id} ({muscle_entry.get('muscle_name')}) "
                        f"not found during restore of pose {pose_id}. "
                        f"This muscle was skipped."
                    )
                    warnings.append(
                        f"Muscle '{muscle_entry.get('muscle_name', muscle_id)}' "
                        f"no longer exists and was skipped"
                    )

        await db.flush()

        # Refresh to get updated relationships
        await db.refresh(pose)

        logger.info(
            f"Restored pose {pose_id} to version {version.version_number}"
            f"{f' with {len(warnings)} warnings' if warnings else ''}"
        )

        return RestoreResult(
            pose=pose,
            warnings=warnings,
            missing_muscles=missing_muscles
        )

    async def diff_versions(
        self,
        db: AsyncSession,
        version_id_1: int,
        version_id_2: int
    ) -> Optional[Dict[str, Any]]:
        """
        Compare two versions and return their differences.

        Args:
            db: Database session
            version_id_1: First version ID (usually older)
            version_id_2: Second version ID (usually newer)

        Returns:
            Dictionary with version info and list of differences
        """
        # Fetch both versions
        result1 = await db.execute(
            select(PoseVersion)
            .options(selectinload(PoseVersion.changed_by))
            .where(PoseVersion.id == version_id_1)
        )
        version1 = result1.scalar_one_or_none()

        result2 = await db.execute(
            select(PoseVersion)
            .options(selectinload(PoseVersion.changed_by))
            .where(PoseVersion.id == version_id_2)
        )
        version2 = result2.scalar_one_or_none()

        if not version1 or not version2:
            return None

        # Ensure they belong to the same pose
        if version1.pose_id != version2.pose_id:
            return None

        differences = []

        # Compare text/simple fields
        for field in self.VERSIONED_FIELDS:
            old_value = getattr(version1, field)
            new_value = getattr(version2, field)

            if old_value != new_value:
                differences.append({
                    "field": field,
                    "old_value": old_value,
                    "new_value": new_value,
                })

        # Compare muscles
        old_muscles, _ = self._deserialize_muscles(version1.muscles_json)
        new_muscles, _ = self._deserialize_muscles(version2.muscles_json)

        # Create muscle lookup maps (filter out entries without muscle_id)
        old_muscles_map = {
            m["muscle_id"]: m for m in old_muscles if m.get("muscle_id") is not None
        }
        new_muscles_map = {
            m["muscle_id"]: m for m in new_muscles if m.get("muscle_id") is not None
        }

        # Find muscle changes
        all_muscle_ids = set(old_muscles_map.keys()) | set(new_muscles_map.keys())
        muscles_changed = False
        muscle_changes = []

        for muscle_id in all_muscle_ids:
            old_muscle = old_muscles_map.get(muscle_id)
            new_muscle = new_muscles_map.get(muscle_id)

            if old_muscle and not new_muscle:
                # Muscle removed
                muscles_changed = True
                muscle_changes.append({
                    "type": "removed",
                    "muscle_id": muscle_id,
                    "muscle_name": old_muscle.get("muscle_name"),
                    "old_activation": old_muscle.get("activation_level"),
                })
            elif new_muscle and not old_muscle:
                # Muscle added
                muscles_changed = True
                muscle_changes.append({
                    "type": "added",
                    "muscle_id": muscle_id,
                    "muscle_name": new_muscle.get("muscle_name"),
                    "new_activation": new_muscle.get("activation_level"),
                })
            elif old_muscle and new_muscle:
                old_activation = old_muscle.get("activation_level")
                new_activation = new_muscle.get("activation_level")
                if old_activation != new_activation:
                    # Activation changed
                    muscles_changed = True
                    muscle_changes.append({
                        "type": "changed",
                        "muscle_id": muscle_id,
                        "muscle_name": new_muscle.get("muscle_name"),
                        "old_activation": old_activation,
                        "new_activation": new_activation,
                    })

        if muscles_changed:
            differences.append({
                "field": "muscles",
                "old_value": old_muscles,
                "new_value": new_muscles,
                "changes": muscle_changes,
            })

        return {
            "version_1": {
                "id": version1.id,
                "version_number": version1.version_number,
                "change_note": version1.change_note,
                "changed_by_name": version1.changed_by.name if version1.changed_by else None,
                "created_at": version1.created_at.isoformat() if version1.created_at else None,
            },
            "version_2": {
                "id": version2.id,
                "version_number": version2.version_number,
                "change_note": version2.change_note,
                "changed_by_name": version2.changed_by.name if version2.changed_by else None,
                "created_at": version2.created_at.isoformat() if version2.created_at else None,
            },
            "differences": differences,
        }

    async def get_version_count(
        self,
        db: AsyncSession,
        pose_id: int
    ) -> int:
        """Get the total number of versions for a pose."""
        result = await db.execute(
            select(func.count(PoseVersion.id))
            .where(PoseVersion.pose_id == pose_id)
        )
        return result.scalar() or 0


# Singleton instance for easy access
versioning_service = VersioningService()
