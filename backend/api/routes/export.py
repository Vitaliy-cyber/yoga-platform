"""
Export API routes for yoga-platform.
Provides endpoints for exporting poses in JSON, CSV, PDF formats and full backups.
"""

import csv
import io
import json
import logging
import asyncio
import random
import time
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import and_, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.database import get_db
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User
from schemas.export import (
    BackupData,
    BackupMetadata,
    CategoryExport,
    MuscleExport,
    PoseExport,
)
from schemas.validators import strip_invisible_edges
from services.auth import get_current_user
from services.csv_security import escape_muscle_name_for_csv, sanitize_csv_field
from services.pdf_generator import PosePDFGenerator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["export"])


def sanitize_filename(name: str) -> str:
    """
    Sanitize a string for use in filenames.

    Removes path traversal characters and other dangerous characters
    that could be used for directory traversal or other attacks.
    Only allows alphanumeric characters, hyphens, underscores, and spaces.
    """
    import os

    # First, get just the basename to remove any path components
    name = os.path.basename(name)

    # Replace any dangerous characters with underscores
    safe_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ ")
    sanitized = "".join(c if c in safe_chars else "_" for c in name)

    # Remove any leading/trailing underscores or spaces
    sanitized = sanitized.strip("_ ")

    # Ensure we have something left
    if not sanitized:
        sanitized = "unnamed"

    # Limit length to prevent issues
    return sanitized[:100]


def _utf8_safe_text(text: str) -> str:
    """
    Ensure response text is UTF-8 encodable.

    Defensive hardening: unpaired surrogates can exist in legacy DB rows (e.g.,
    via JSON escape sequences). Starlette encodes Response bodies as UTF-8; if
    the body contains surrogates it can crash and return 500.
    """
    if not isinstance(text, str):
        return text
    try:
        text.encode("utf-8")
        return text
    except UnicodeEncodeError:
        return text.encode("utf-8", "backslashreplace").decode("utf-8")


def _safe_export_text(
    value: object,
    *,
    max_len: int,
    default: str,
    empty_to_none: bool = False,
) -> str | None:
    if value is None:
        return None if empty_to_none else default
    if not isinstance(value, str):
        value = str(value)
    normalized = strip_invisible_edges(value)
    if not normalized:
        return None if empty_to_none else default
    normalized = _utf8_safe_text(normalized)
    return normalized[:max_len]

# Rate limiting configuration for backup endpoint
# More restrictive than general endpoints due to resource intensity
BACKUP_RATE_LIMIT_REQUESTS = 5  # Max requests
BACKUP_RATE_LIMIT_WINDOW = 3600  # Time window in seconds (1 hour)

# In-memory rate limiting store (keyed by user_id)
# In production, use Redis or similar for distributed deployments
_backup_rate_limit_store: Dict[int, List[float]] = defaultdict(list)


def _check_backup_rate_limit(user_id: int) -> bool:
    """
    Check if user has exceeded backup rate limit.

    Returns True if request is allowed, False if rate limited.
    """
    current_time = time.time()
    window_start = current_time - BACKUP_RATE_LIMIT_WINDOW

    # Get user's request timestamps
    timestamps = _backup_rate_limit_store[user_id]

    # Remove expired timestamps
    timestamps[:] = [ts for ts in timestamps if ts > window_start]

    # Check if limit exceeded
    if len(timestamps) >= BACKUP_RATE_LIMIT_REQUESTS:
        return False

    # Record this request
    timestamps.append(current_time)
    return True


def build_pose_export(pose: Pose) -> PoseExport:
    """Convert Pose model to PoseExport schema."""
    muscles = []
    for pm in pose.pose_muscles:
        muscles.append(MuscleExport(
            name=pm.muscle.name,
            name_ua=pm.muscle.name_ua,
            body_part=pm.muscle.body_part,
            activation_level=pm.activation_level,
        ))

    return PoseExport(
        code=pose.code,
        name=pose.name,
        name_en=pose.name_en,
        category_name=_safe_export_text(
            pose.category.name if pose.category else None,
            max_len=100,
            default="",
            empty_to_none=True,
        ),
        description=pose.description,
        effect=pose.effect,
        breathing=pose.breathing,
        muscles=muscles,
        schema_path=pose.schema_path,
        photo_path=pose.photo_path,
        muscle_layer_path=pose.muscle_layer_path,
        skeleton_layer_path=pose.skeleton_layer_path,
        created_at=pose.created_at,
        updated_at=pose.updated_at,
    )


def build_category_export(category: Category) -> CategoryExport:
    """Convert Category model to CategoryExport schema."""
    return CategoryExport(
        name=(_safe_export_text(category.name, max_len=100, default="unnamed") or "unnamed"),
        description=_safe_export_text(
            category.description,
            max_len=2000,
            default="",
            empty_to_none=True,
        ),
    )


async def get_user_poses(
    db: AsyncSession,
    user_id: int,
    category_id: Optional[int] = None,
) -> List[Pose]:
    """Get all poses for a user, optionally filtered by category."""
    async def _run() -> List[Pose]:
        query = (
            select(Pose)
            .options(
                selectinload(Pose.category),
                selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
            )
            .where(Pose.user_id == user_id)
            .order_by(Pose.code)
        )

        if category_id:
            query = query.where(Pose.category_id == category_id)

        result = await db.execute(query)
        return list(result.scalars().all())

    max_attempts = 8
    for attempt in range(max_attempts):
        try:
            return await _run()
        except OperationalError:
            await db.rollback()
            if attempt >= max_attempts - 1:
                break
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Conflict while exporting poses. Please retry.",
    )


async def get_user_categories(db: AsyncSession, user_id: int) -> List[Category]:
    """Get all categories for a user."""
    max_attempts = 8
    for attempt in range(max_attempts):
        try:
            result = await db.execute(
                select(Category)
                .where(Category.user_id == user_id)
                .order_by(Category.name)
            )
            return list(result.scalars().all())
        except OperationalError:
            await db.rollback()
            if attempt >= max_attempts - 1:
                break
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Conflict while exporting categories. Please retry.",
    )


@router.get("/poses/json")
async def export_poses_json(
    category_id: Optional[int] = Query(
        None, ge=1, description="Filter by category ID"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Export all user poses in JSON format.

    Optionally filter by category. Returns a downloadable JSON file.
    """
    poses = await get_user_poses(db, current_user.id, category_id)

    if not poses:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No poses found to export",
        )

    export_data = [build_pose_export(pose).model_dump(mode="json") for pose in poses]

    # Create JSON content
    json_content = _utf8_safe_text(json.dumps(export_data, ensure_ascii=False, indent=2))

    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"poses_export_{timestamp}.json"

    return Response(
        content=json_content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Items": str(len(export_data)),
        },
    )


@router.get("/poses/csv")
async def export_poses_csv(
    category_id: Optional[int] = Query(
        None, ge=1, description="Filter by category ID"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Export poses in CSV format.

    Images are not included in CSV export. Muscles are represented as
    comma-separated "name:activation_level" pairs.
    """
    poses = await get_user_poses(db, current_user.id, category_id)

    if not poses:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No poses found to export",
        )

    # Create CSV in memory with QUOTE_ALL to provide additional protection
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    # Header row
    writer.writerow([
        "code",
        "name",
        "name_en",
        "category_name",
        "description",
        "effect",
        "breathing",
        "muscles",
    ])

    # Data rows - sanitize all fields to prevent CSV injection
    for pose in poses:
        pose_export = build_pose_export(pose)

        # Format muscles as "name:level,name:level"
        # Sanitize muscle names as well
        muscles_str = ",".join(
            f"{escape_muscle_name_for_csv(m.name)}:{m.activation_level}"
            for m in pose_export.muscles
        )

        writer.writerow([
            sanitize_csv_field(pose_export.code),
            sanitize_csv_field(pose_export.name),
            sanitize_csv_field(pose_export.name_en),
            sanitize_csv_field(pose_export.category_name),
            sanitize_csv_field(pose_export.description),
            sanitize_csv_field(pose_export.effect),
            sanitize_csv_field(pose_export.breathing),
            muscles_str,
        ])

    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"poses_export_{timestamp}.csv"

    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Items": str(len(poses)),
        },
    )


@router.get("/pose/{pose_id}/pdf")
async def export_pose_pdf(
    pose_id: int,
    include_photo: bool = Query(True, description="Include generated photo"),
    include_schema: bool = Query(True, description="Include source schematic"),
    include_muscle_layer: bool = Query(True, description="Include muscle visualization"),
    include_muscles_list: bool = Query(True, description="Include muscle activation table"),
    include_description: bool = Query(True, description="Include text descriptions"),
    page_size: Literal["A4", "Letter"] = Query(
        "A4", description="Page size (A4 or Letter)"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Export a single pose as PDF.

    Generates a beautiful PDF with images, muscle diagrams, and descriptions.
    """
    # Get pose with all relations
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )

    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose not found",
        )

    # Convert to dict for PDF generator
    pose_data = {
        "code": pose.code,
        "name": pose.name,
        "name_en": pose.name_en,
        "category_name": pose.category.name if pose.category else None,
        "description": pose.description,
        "effect": pose.effect,
        "breathing": pose.breathing,
        "schema_path": pose.schema_path,
        "photo_path": pose.photo_path,
        "muscle_layer_path": pose.muscle_layer_path,
        "muscles": [
            {
                "muscle_name": pm.muscle.name,
                "muscle_name_ua": pm.muscle.name_ua,
                "body_part": pm.muscle.body_part,
                "activation_level": pm.activation_level,
            }
            for pm in pose.pose_muscles
        ],
    }

    # Generate PDF
    generator = PosePDFGenerator(page_size=page_size)
    pdf_bytes = await generator.generate_pose_pdf(
        pose_data,
        include_photo=include_photo,
        include_schema=include_schema,
        include_muscle_layer=include_muscle_layer,
        include_muscles_list=include_muscles_list,
        include_description=include_description,
    )

    # Generate filename (sanitize pose code and name to prevent path traversal)
    safe_code = sanitize_filename(pose.code)
    safe_name = sanitize_filename(pose.name)
    filename = f"{safe_code}_{safe_name}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/poses/pdf")
async def export_all_poses_pdf(
    category_id: Optional[int] = Query(
        None, ge=1, description="Filter by category ID"
    ),
    page_size: Literal["A4", "Letter"] = Query(
        "A4", description="Page size (A4 or Letter)"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Export all poses as a multi-page PDF.

    Each pose gets its own page. Useful for printing pose collections.
    """
    poses = await get_user_poses(db, current_user.id, category_id)

    if not poses:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No poses found to export",
        )

    # Convert poses to dict format
    poses_data = []
    for pose in poses:
        poses_data.append({
            "code": pose.code,
            "name": pose.name,
            "name_en": pose.name_en,
            "category_name": pose.category.name if pose.category else None,
            "description": pose.description,
            "photo_path": pose.photo_path,
            "muscles": [
                {
                    "muscle_name": pm.muscle.name,
                    "activation_level": pm.activation_level,
                }
                for pm in pose.pose_muscles
            ],
        })

    # Generate PDF
    generator = PosePDFGenerator(page_size=page_size)
    pdf_bytes = await generator.generate_multiple_poses_pdf(
        poses_data,
        title="Моя колекція йога-поз",
    )

    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"poses_collection_{timestamp}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Items": str(len(poses)),
        },
    )


@router.get("/backup")
async def export_backup(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Export full backup of user data.

    Includes all poses and categories in a single JSON file.
    This can be used to restore data using the import endpoint.

    Rate limited to 5 requests per hour due to resource intensity.
    """
    # Check rate limit (stricter for backup endpoint)
    if not _check_backup_rate_limit(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Rate limit exceeded. Maximum {BACKUP_RATE_LIMIT_REQUESTS} "
                f"backup exports per hour. Please try again later."
            ),
            headers={"Retry-After": str(BACKUP_RATE_LIMIT_WINDOW)},
        )

    # Get all poses and categories
    poses = await get_user_poses(db, current_user.id)
    categories = await get_user_categories(db, current_user.id)

    # Build backup data
    backup = BackupData(
        metadata=BackupMetadata(
            version="1.0.0",
            exported_at=datetime.utcnow(),
            user_id=current_user.id,
            total_poses=len(poses),
            total_categories=len(categories),
        ),
        categories=[build_category_export(cat) for cat in categories],
        poses=[build_pose_export(pose) for pose in poses],
    )

    # Serialize to JSON
    json_content = _utf8_safe_text(backup.model_dump_json(indent=2))

    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"yoga_backup_{timestamp}.json"

    return Response(
        content=json_content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Poses": str(len(poses)),
            "X-Total-Categories": str(len(categories)),
        },
    )


@router.get("/categories/json")
async def export_categories_json(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Export all user categories in JSON format.
    """
    categories = await get_user_categories(db, current_user.id)

    if not categories:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No categories found to export",
        )

    export_data = [build_category_export(cat).model_dump(mode="json") for cat in categories]

    # Create JSON content
    json_content = _utf8_safe_text(json.dumps(export_data, ensure_ascii=False, indent=2))

    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"categories_export_{timestamp}.json"

    return Response(
        content=json_content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Items": str(len(export_data)),
        },
    )
