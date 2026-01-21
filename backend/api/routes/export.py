"""
Export API routes for yoga-platform.
Provides endpoints for exporting poses in JSON, CSV, PDF formats and full backups.
"""

import csv
import io
import json
import logging
import time
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import and_, select
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
from services.auth import get_current_user
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


# CSV Injection protection characters
CSV_INJECTION_CHARS = ("=", "+", "-", "@", "\t", "\r", "\n")


def sanitize_csv_field(value: Optional[str]) -> str:
    """
    Sanitize a field for CSV export to prevent formula injection attacks.

    Excel, Google Sheets, and other spreadsheet applications can execute
    formulas when a cell starts with certain characters (=, +, -, @, etc.).
    This can lead to arbitrary command execution or data exfiltration.

    Mitigation: Prefix dangerous values with a single quote, which forces
    the spreadsheet application to treat the content as text.
    """
    if value is None:
        return ""

    # Convert to string
    str_value = str(value)

    # Check if value starts with injection characters
    if str_value and str_value[0] in CSV_INJECTION_CHARS:
        # Prefix with single quote to escape
        return "'" + str_value

    # Also check for embedded dangerous characters that could be exploited
    # in certain contexts (though less common)
    if any(char in str_value for char in ("\t", "\r", "\n")):
        # Replace with spaces to prevent manipulation
        str_value = str_value.replace("\t", " ").replace("\r", " ").replace("\n", " ")

    return str_value


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
        category_name=pose.category.name if pose.category else None,
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
        name=category.name,
        description=category.description,
    )


async def get_user_poses(
    db: AsyncSession,
    user_id: int,
    category_id: Optional[int] = None,
) -> List[Pose]:
    """Get all poses for a user, optionally filtered by category."""
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


async def get_user_categories(db: AsyncSession, user_id: int) -> List[Category]:
    """Get all categories for a user."""
    result = await db.execute(
        select(Category)
        .where(Category.user_id == user_id)
        .order_by(Category.name)
    )
    return list(result.scalars().all())


@router.get("/poses/json")
async def export_poses_json(
    category_id: Optional[int] = Query(None, description="Filter by category ID"),
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
    json_content = json.dumps(export_data, ensure_ascii=False, indent=2)

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
    category_id: Optional[int] = Query(None, description="Filter by category ID"),
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
            f"{sanitize_csv_field(m.name)}:{m.activation_level}"
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
    page_size: str = Query("A4", description="Page size (A4 or Letter)"),
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
    category_id: Optional[int] = Query(None, description="Filter by category ID"),
    page_size: str = Query("A4", description="Page size (A4 or Letter)"),
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
        title="My Yoga Poses Collection",
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
    json_content = backup.model_dump_json(indent=2)

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
    json_content = json.dumps(export_data, ensure_ascii=False, indent=2)

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
