"""
API routes for pose version history management.

Provides endpoints for:
- Listing version history
- Viewing version details
- Restoring to previous versions
- Comparing versions (diff)
"""

import json
import asyncio
import random
from typing import List

from db.database import get_db
from fastapi import APIRouter, Depends, HTTPException, Query, status
from models.pose import Pose
from models.user import User
from schemas.version import (
    PaginatedVersionResponse,
    PoseVersionDetailResponse,
    PoseVersionListResponse,
    RestoreVersionRequest,
    VersionComparisonResult,
    VersionCountResponse,
    VersionDiff,
    VersionMuscleSnapshot,
    VersionSummary,
)
from services.auth import get_current_user
from services.versioning import versioning_service
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

router = APIRouter(prefix="/poses/{pose_id}/versions", tags=["versions"])


async def get_user_pose(
    pose_id: int,
    current_user: User,
    db: AsyncSession
) -> Pose:
    """
    Helper to get a pose and verify ownership.
    Raises 404 if not found or not owned by user.
    """
    # Reads can still hit transient SQLite contention under parallel E2E load.
    # Retry/backoff so ownership checks stay stable and don't devolve into 5xx/flake.
    max_attempts = 12
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            result = await db.execute(
                select(Pose).where(
                    and_(Pose.id == pose_id, Pose.user_id == current_user.id)
                )
            )
            pose = result.scalar_one_or_none()
            if not pose:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Pose not found"
                )
            return pose
        except OperationalError as e:
            last_err = e
            await db.rollback()
            if attempt >= max_attempts - 1:
                break
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Conflict while reading pose. Please retry.",
    )


def build_version_list_response(version) -> PoseVersionListResponse:
    """Build list response from PoseVersion model."""
    return PoseVersionListResponse(
        id=version.id,
        version_number=version.version_number,
        name=version.name,
        change_note=version.change_note,
        changed_by_name=version.changed_by.name if version.changed_by else None,
        created_at=version.created_at,
    )


def build_version_detail_response(version) -> PoseVersionDetailResponse:
    """Build detailed response from PoseVersion model."""
    # Parse muscles JSON
    muscles = []
    if version.muscles_json:
        try:
            muscles_data = json.loads(version.muscles_json)
            if isinstance(muscles_data, list):
                for m in muscles_data:
                    if not isinstance(m, dict):
                        continue
                    raw_level = m.get("activation_level", 50)
                    try:
                        level = int(raw_level)  # type: ignore[arg-type]
                    except Exception:
                        level = 50
                    if level < 0:
                        level = 0
                    if level > 100:
                        level = 100
                    muscles.append(
                        VersionMuscleSnapshot(
                            muscle_id=m.get("muscle_id"),
                            muscle_name=m.get("muscle_name"),
                            muscle_name_ua=m.get("muscle_name_ua"),
                            body_part=m.get("body_part"),
                            activation_level=level,
                        )
                    )
        except json.JSONDecodeError:
            pass
        except Exception:
            # Corrupted/unexpected version data should not crash the endpoint.
            muscles = []

    return PoseVersionDetailResponse(
        id=version.id,
        version_number=version.version_number,
        name=version.name,
        name_en=version.name_en,
        code=version.code,
        category_id=version.category_id,
        description=version.description,
        effect=version.effect,
        breathing=version.breathing,
        schema_path=version.schema_path,
        photo_path=version.photo_path,
        muscle_layer_path=version.muscle_layer_path,
        skeleton_layer_path=version.skeleton_layer_path,
        muscles=muscles,
        change_note=version.change_note,
        changed_by_name=version.changed_by.name if version.changed_by else None,
        created_at=version.created_at,
    )


@router.get("", response_model=PaginatedVersionResponse)
async def list_versions(
    pose_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List all versions for a pose.

    Returns a paginated list of versions ordered by version_number descending
    (newest first). The response includes items, total count, skip, and limit.
    """
    # Verify pose ownership
    await get_user_pose(pose_id, current_user, db)

    max_attempts = 8
    total = 0
    versions = []
    for attempt in range(max_attempts):
        try:
            # Get total count
            total = await versioning_service.get_version_count(db, pose_id)

            # Get paginated versions
            versions = await versioning_service.get_versions(db, pose_id, skip, limit)
            break
        except OperationalError:
            await db.rollback()
            if attempt >= max_attempts - 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Conflict while listing versions. Please retry.",
                )
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)
    items = [build_version_list_response(v) for v in versions]

    return PaginatedVersionResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/count", response_model=VersionCountResponse)
async def get_version_count(
    pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the total number of versions for a pose."""
    await get_user_pose(pose_id, current_user, db)
    max_attempts = 8
    for attempt in range(max_attempts):
        try:
            count = await versioning_service.get_version_count(db, pose_id)
            return VersionCountResponse(pose_id=pose_id, version_count=count)
        except OperationalError:
            await db.rollback()
            if attempt >= max_attempts - 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Conflict while counting versions. Please retry.",
                )
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)


@router.get("/{version_id}", response_model=PoseVersionDetailResponse)
async def get_version(
    pose_id: int,
    version_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a specific version.

    Includes all snapshot data: name, description, muscles, image paths, etc.
    """
    await get_user_pose(pose_id, current_user, db)

    max_attempts = 8
    version = None
    for attempt in range(max_attempts):
        try:
            version = await versioning_service.get_version(db, pose_id, version_id)
            break
        except OperationalError:
            await db.rollback()
            if attempt >= max_attempts - 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Conflict while reading version. Please retry.",
                )
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )

    return build_version_detail_response(version)


@router.post("/{version_id}/restore", response_model=dict)
async def restore_version(
    pose_id: int,
    version_id: int,
    request: RestoreVersionRequest = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Restore a pose to a specific version.

    This operation:
    1. Creates a new version capturing the current state
    2. Updates the pose with the selected version's data
    3. Returns success confirmation with any warnings

    The change_note parameter allows describing why the restore was performed.
    """
    await get_user_pose(pose_id, current_user, db)

    change_note = request.change_note if request else None

    try:
        result = await versioning_service.restore_version(
            db, pose_id, version_id, current_user.id, change_note
        )
    except ValueError:
        # This is raised when muscles_json is corrupted; don't leak raw exception text.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid version data",
        )
    except (IntegrityError, OperationalError, StaleDataError):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while restoring version. Please retry.",
        )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )

    try:
        await db.commit()
    except (IntegrityError, OperationalError, StaleDataError):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while restoring version. Please retry.",
        )

    response = {
        "success": True,
        "message": "Pose restored to version successfully",
        "pose_id": result.pose.id,
    }

    # Include warnings if any muscles were missing or had issues
    if result.warnings:
        response["warnings"] = result.warnings

    if result.missing_muscles:
        response["missing_muscles"] = result.missing_muscles

    return response


@router.get("/{v1}/diff/{v2}", response_model=VersionComparisonResult)
async def diff_versions(
    pose_id: int,
    v1: int,
    v2: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Compare two versions and return their differences.

    v1 and v2 are version IDs (not version numbers).
    The response includes detailed field-by-field differences.
    """
    await get_user_pose(pose_id, current_user, db)

    max_attempts = 8
    for attempt in range(max_attempts):
        try:
            # Verify both versions belong to this pose
            version1 = await versioning_service.get_version(db, pose_id, v1)
            version2 = await versioning_service.get_version(db, pose_id, v2)

            if not version1 or not version2:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="One or both versions not found"
                )

            diff_result = await versioning_service.diff_versions(db, v1, v2)

            if not diff_result:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Could not compare versions"
                )
            break
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid version data",
            )
        except OperationalError:
            await db.rollback()
            if attempt >= max_attempts - 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Conflict while comparing versions. Please retry.",
                )
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)

    return VersionComparisonResult(
        version_1=VersionSummary(**diff_result["version_1"]),
        version_2=VersionSummary(**diff_result["version_2"]),
        differences=[VersionDiff(**d) for d in diff_result["differences"]],
    )
