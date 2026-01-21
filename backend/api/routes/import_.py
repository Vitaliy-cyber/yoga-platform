"""
Import API routes for yoga-platform.
Provides endpoints for importing poses from JSON, CSV files and restoring backups.
"""

import csv
import io
import json
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import and_, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User
from schemas.export import (
    BackupData,
    CategoryExport,
    DuplicateHandling,
    ImportItemResult,
    ImportOptions,
    ImportPreviewItem,
    ImportPreviewResult,
    ImportResult,
    MuscleExport,
    PoseExport,
)
from services.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/import", tags=["import"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
CHUNK_SIZE = 64 * 1024  # 64KB chunks for streaming file reads

# Maximum number of retries for race condition handling
MAX_RETRY_ATTEMPTS = 3

# File type validation
try:
    import magic
    MAGIC_AVAILABLE = True
except ImportError:
    MAGIC_AVAILABLE = False
    logger.warning(
        "python-magic not available. File type validation will be limited to "
        "extension checks only. Install python-magic for enhanced security."
    )

# Expected MIME types
EXPECTED_MIME_TYPES = {
    ".json": ["application/json", "text/plain", "text/json"],
    ".csv": ["text/csv", "text/plain", "application/csv"],
}


async def validate_file_size(file: UploadFile) -> bytes:
    """
    Read and validate file size using streaming to prevent memory exhaustion.

    Reads file in chunks and aborts early if size limit is exceeded.
    This prevents an attacker from exhausting server memory by uploading
    a very large file.
    """
    chunks = []
    total_size = 0

    # Read file in chunks
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break

        total_size += len(chunk)

        # Check size limit BEFORE adding chunk to list
        if total_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File too large. Maximum size is {MAX_FILE_SIZE // 1024 // 1024}MB",
            )

        chunks.append(chunk)

    return b"".join(chunks)


def validate_file_mime_type(content: bytes, expected_extension: str) -> bool:
    """
    Validate file content matches expected MIME type.

    Uses python-magic if available, otherwise falls back to basic checks.
    Returns True if validation passes, raises HTTPException if it fails.
    """
    if not MAGIC_AVAILABLE:
        # Fallback: basic content validation
        if expected_extension == ".json":
            # Check if content looks like JSON
            try:
                decoded = content.decode("utf-8").strip()
                if not (decoded.startswith("{") or decoded.startswith("[")):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="File content does not appear to be valid JSON",
                    )
            except UnicodeDecodeError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="File content is not valid UTF-8 text",
                )
        elif expected_extension == ".csv":
            # Check if content looks like CSV (text with commas)
            try:
                content.decode("utf-8")
            except UnicodeDecodeError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="File content is not valid UTF-8 text",
                )
        return True

    # Use python-magic for proper MIME type detection
    try:
        mime = magic.Magic(mime=True)
        detected_type = mime.from_buffer(content[:2048])  # Read first 2KB

        expected_types = EXPECTED_MIME_TYPES.get(expected_extension, [])

        if detected_type not in expected_types:
            logger.warning(
                f"MIME type mismatch: expected {expected_types}, got {detected_type}"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"File content type ({detected_type}) does not match "
                    f"expected type for {expected_extension} files"
                ),
            )
        return True

    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"MIME type validation error: {e}")
        # On error, fall back to permissive behavior but log it
        return True


def sanitize_error_message(error: Exception) -> str:
    """
    Sanitize error messages to prevent information disclosure.

    Removes SQL-specific details, file paths, and other sensitive information
    that could be useful for attackers.
    """
    error_str = str(error)

    # Patterns to remove (SQL details, file paths, etc.)
    sensitive_patterns = [
        # SQL-related patterns
        (r"(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|AND|OR)\s+[\w\s,.*=<>]+", "[SQL query hidden]"),
        (r"sqlalchemy\.[a-zA-Z.]+", "[database error]"),
        (r"psycopg2\.[a-zA-Z.]+", "[database error]"),
        (r"sqlite3\.[a-zA-Z.]+", "[database error]"),
        # File path patterns
        (r"/[a-zA-Z0-9_/.-]+\.py", "[internal path]"),
        (r"line \d+, in \w+", "[location hidden]"),
        # Stack trace patterns
        (r"Traceback \(most recent call last\):[\s\S]+", "[stack trace hidden]"),
        # Database constraint names
        (r"(UNIQUE|FOREIGN KEY|CHECK)\s+constraint\s+[\w_]+", "[constraint violation]"),
    ]

    sanitized = error_str
    for pattern, replacement in sensitive_patterns:
        sanitized = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)

    # Truncate very long messages
    max_length = 200
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + "..."

    return sanitized


async def get_or_create_category(
    db: AsyncSession,
    user_id: int,
    category_name: str,
    description: Optional[str] = None,
) -> Tuple[Category, bool]:
    """
    Get existing category or create new one.

    Returns tuple of (category, was_created).
    """
    # Check if category exists
    result = await db.execute(
        select(Category).where(
            and_(
                func.lower(Category.name) == category_name.lower(),
                Category.user_id == user_id,
            )
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        return existing, False

    # Create new category
    new_category = Category(
        user_id=user_id,
        name=category_name,
        description=description,
    )
    db.add(new_category)
    await db.flush()

    return new_category, True


async def get_muscle_by_name(db: AsyncSession, muscle_name: str) -> Optional[Muscle]:
    """Get muscle by name (case-insensitive)."""
    result = await db.execute(
        select(Muscle).where(func.lower(Muscle.name) == muscle_name.lower())
    )
    return result.scalar_one_or_none()


async def check_pose_exists(
    db: AsyncSession,
    user_id: int,
    code: str,
    for_update: bool = False,
) -> Optional[Pose]:
    """
    Check if pose with given code exists for user.

    Args:
        db: Database session
        user_id: User ID
        code: Pose code to check
        for_update: If True, uses SELECT FOR UPDATE to lock the row
                   (for race condition prevention)
    """
    query = select(Pose).where(
        and_(
            Pose.code == code,
            Pose.user_id == user_id,
        )
    )

    if for_update:
        # Use FOR UPDATE to lock the row and prevent race conditions
        query = query.with_for_update(skip_locked=False)

    result = await db.execute(query)
    return result.scalar_one_or_none()


def _clamp_activation_level(level: int) -> int:
    """Clamp activation level to valid 0-100 range."""
    return max(0, min(100, level))


async def import_single_pose(
    db: AsyncSession,
    user_id: int,
    pose_data: PoseExport,
    duplicate_handling: DuplicateHandling,
    category_cache: Dict[str, Category],
    retry_count: int = 0,
) -> ImportItemResult:
    """
    Import a single pose with race condition handling.

    Uses SELECT FOR UPDATE for pose code uniqueness checks to prevent
    race conditions in concurrent imports. Includes retry logic for
    handling transient failures.

    Returns ImportItemResult with status.
    """
    try:
        # Use SELECT FOR UPDATE to prevent race conditions when checking
        # for existing poses with the same code
        existing_pose = await check_pose_exists(
            db, user_id, pose_data.code, for_update=True
        )

        if existing_pose:
            if duplicate_handling == DuplicateHandling.SKIP:
                return ImportItemResult(
                    code=pose_data.code,
                    name=pose_data.name,
                    status="skipped",
                    message="Pose already exists",
                )
            elif duplicate_handling == DuplicateHandling.RENAME:
                # Find unique code with locking to prevent race conditions
                base_code = pose_data.code
                counter = 1
                # Limit search to prevent infinite loops
                max_attempts = 100
                while counter < max_attempts:
                    new_code = f"{base_code}_{counter}"
                    if not await check_pose_exists(db, user_id, new_code, for_update=True):
                        pose_data.code = new_code
                        existing_pose = None  # Create new with renamed code
                        break
                    counter += 1
                else:
                    return ImportItemResult(
                        code=pose_data.code,
                        name=pose_data.name,
                        status="error",
                        message="Could not generate unique code after many attempts",
                    )
            # For OVERWRITE, we continue and update existing_pose

        # Handle category
        category_id = None
        if pose_data.category_name:
            if pose_data.category_name in category_cache:
                category_id = category_cache[pose_data.category_name].id
            else:
                category, _ = await get_or_create_category(
                    db, user_id, pose_data.category_name
                )
                category_cache[pose_data.category_name] = category
                category_id = category.id

        if existing_pose and duplicate_handling == DuplicateHandling.OVERWRITE:
            # Update existing pose
            existing_pose.name = pose_data.name
            existing_pose.name_en = pose_data.name_en
            existing_pose.category_id = category_id
            existing_pose.description = pose_data.description
            existing_pose.effect = pose_data.effect
            existing_pose.breathing = pose_data.breathing

            # Remove old muscles
            for pm in existing_pose.pose_muscles:
                await db.delete(pm)

            # Add new muscles with activation level validation
            for muscle_data in pose_data.muscles:
                muscle = await get_muscle_by_name(db, muscle_data.name)
                if muscle:
                    # Clamp activation level to 0-100 range
                    clamped_level = _clamp_activation_level(muscle_data.activation_level)
                    pose_muscle = PoseMuscle(
                        pose_id=existing_pose.id,
                        muscle_id=muscle.id,
                        activation_level=clamped_level,
                    )
                    db.add(pose_muscle)

            return ImportItemResult(
                code=pose_data.code,
                name=pose_data.name,
                status="updated",
                message="Pose updated successfully",
            )
        else:
            # Create new pose
            new_pose = Pose(
                user_id=user_id,
                code=pose_data.code,
                name=pose_data.name,
                name_en=pose_data.name_en,
                category_id=category_id,
                description=pose_data.description,
                effect=pose_data.effect,
                breathing=pose_data.breathing,
            )
            db.add(new_pose)
            await db.flush()

            # Add muscles with activation level validation
            for muscle_data in pose_data.muscles:
                muscle = await get_muscle_by_name(db, muscle_data.name)
                if muscle:
                    # Clamp activation level to 0-100 range
                    clamped_level = _clamp_activation_level(muscle_data.activation_level)
                    pose_muscle = PoseMuscle(
                        pose_id=new_pose.id,
                        muscle_id=muscle.id,
                        activation_level=clamped_level,
                    )
                    db.add(pose_muscle)

            return ImportItemResult(
                code=pose_data.code,
                name=pose_data.name,
                status="created",
                message="Pose created successfully",
            )

    except ValidationError as e:
        # Pydantic validation errors - safe to expose details
        logger.warning(f"Validation error importing pose {pose_data.code}: {e}")
        return ImportItemResult(
            code=pose_data.code,
            name=pose_data.name,
            status="error",
            message=f"Validation error: {str(e)[:100]}",
        )

    except IntegrityError as e:
        # Database constraint violation - may be a race condition
        logger.warning(f"Integrity error importing pose {pose_data.code}: {e}")

        # Rollback the failed operation
        await db.rollback()

        # Retry with exponential backoff for race conditions
        if retry_count < MAX_RETRY_ATTEMPTS:
            import asyncio
            await asyncio.sleep(0.1 * (2 ** retry_count))  # 0.1s, 0.2s, 0.4s
            return await import_single_pose(
                db, user_id, pose_data, duplicate_handling,
                category_cache, retry_count + 1
            )

        return ImportItemResult(
            code=pose_data.code,
            name=pose_data.name,
            status="error",
            message="Database conflict - please try again",
        )

    except Exception as e:
        # Generic error - sanitize message to prevent information disclosure
        logger.error(f"Error importing pose {pose_data.code}: {e}")
        return ImportItemResult(
            code=pose_data.code,
            name=pose_data.name,
            status="error",
            message=sanitize_error_message(e),
        )


def parse_muscles_from_csv(muscles_str: str) -> List[MuscleExport]:
    """Parse muscles from CSV format: 'muscle1:level,muscle2:level'."""
    if not muscles_str or not muscles_str.strip():
        return []

    muscles = []
    for pair in muscles_str.split(","):
        pair = pair.strip()
        if ":" in pair:
            name, level_str = pair.split(":", 1)
            try:
                level = int(level_str.strip())
                level = max(0, min(100, level))  # Clamp to 0-100
                muscles.append(MuscleExport(
                    name=name.strip(),
                    activation_level=level,
                ))
            except ValueError:
                continue  # Skip invalid entries
        else:
            # If no level specified, use default 50
            muscles.append(MuscleExport(
                name=pair.strip(),
                activation_level=50,
            ))

    return muscles


@router.post("/poses/json", response_model=ImportResult)
async def import_poses_json(
    file: UploadFile = File(...),
    duplicate_handling: DuplicateHandling = DuplicateHandling.SKIP,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Import poses from JSON file.

    Accepts JSON array of pose objects or a backup file format.
    """
    # Validate file extension
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a JSON file (.json)",
        )

    # Read and validate file size (streaming)
    content = await validate_file_size(file)

    # Validate MIME type (if python-magic available)
    validate_file_mime_type(content, ".json")

    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid JSON: {str(e)}",
        )

    # Determine format: array of poses or backup format
    poses_data: List[dict] = []

    if isinstance(data, list):
        # Direct array of poses
        poses_data = data
    elif isinstance(data, dict):
        # Could be backup format
        if "poses" in data:
            poses_data = data["poses"]
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid format: expected array of poses or backup format",
            )

    if not poses_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No poses found in file",
        )

    # Validate and convert to PoseExport
    valid_poses: List[PoseExport] = []
    validation_errors: List[str] = []

    for i, pose_dict in enumerate(poses_data):
        try:
            pose_export = PoseExport(**pose_dict)
            valid_poses.append(pose_export)
        except ValidationError as e:
            validation_errors.append(f"Pose #{i+1}: {str(e)}")

    if not valid_poses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No valid poses in file. Errors: {'; '.join(validation_errors[:5])}",
        )

    # Import poses
    category_cache: Dict[str, Category] = {}
    results: List[ImportItemResult] = []

    for pose_data in valid_poses:
        result = await import_single_pose(
            db, current_user.id, pose_data, duplicate_handling, category_cache
        )
        results.append(result)

    # CRITICAL: Commit the transaction to persist changes
    # flush() only sends changes to database but doesn't commit
    await db.commit()

    # Calculate summary
    created = sum(1 for r in results if r.status == "created")
    updated = sum(1 for r in results if r.status == "updated")
    skipped = sum(1 for r in results if r.status == "skipped")
    errors = sum(1 for r in results if r.status == "error")

    return ImportResult(
        success=errors == 0,
        total_items=len(results),
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
        items=results,
    )


@router.post("/poses/csv", response_model=ImportResult)
async def import_poses_csv(
    file: UploadFile = File(...),
    duplicate_handling: DuplicateHandling = DuplicateHandling.SKIP,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Import poses from CSV file.

    Expected columns: code, name, name_en, category_name, description, effect, breathing, muscles
    Muscles format: "muscle1:level,muscle2:level"
    """
    # Validate file extension
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a CSV file (.csv)",
        )

    # Read and validate file size (streaming)
    content = await validate_file_size(file)

    # Validate MIME type (if python-magic available)
    validate_file_mime_type(content, ".csv")

    try:
        # Decode and parse CSV
        text_content = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(text_content))

        # Validate required columns
        required_columns = {"code", "name"}
        if not reader.fieldnames:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CSV file is empty or has no headers",
            )

        actual_columns = set(reader.fieldnames)
        missing = required_columns - actual_columns
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required columns: {', '.join(missing)}",
            )

        # Parse rows
        valid_poses: List[PoseExport] = []
        validation_errors: List[str] = []

        for i, row in enumerate(reader, start=1):
            try:
                # Parse muscles
                muscles = []
                if row.get("muscles"):
                    muscles = parse_muscles_from_csv(row["muscles"])

                pose_export = PoseExport(
                    code=row["code"].strip(),
                    name=row["name"].strip(),
                    name_en=row.get("name_en", "").strip() or None,
                    category_name=row.get("category_name", "").strip() or None,
                    description=row.get("description", "").strip() or None,
                    effect=row.get("effect", "").strip() or None,
                    breathing=row.get("breathing", "").strip() or None,
                    muscles=muscles,
                )
                valid_poses.append(pose_export)
            except ValidationError as e:
                validation_errors.append(f"Row {i}: {str(e)}")
            except Exception as e:
                validation_errors.append(f"Row {i}: {sanitize_error_message(e)}")

    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File encoding error. Please use UTF-8 encoded CSV",
        )

    if not valid_poses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No valid poses in file. Errors: {'; '.join(validation_errors[:5])}",
        )

    # Import poses
    category_cache: Dict[str, Category] = {}
    results: List[ImportItemResult] = []

    for pose_data in valid_poses:
        result = await import_single_pose(
            db, current_user.id, pose_data, duplicate_handling, category_cache
        )
        results.append(result)

    # CRITICAL: Commit the transaction to persist changes
    # flush() only sends changes to database but doesn't commit
    await db.commit()

    # Calculate summary
    created = sum(1 for r in results if r.status == "created")
    updated = sum(1 for r in results if r.status == "updated")
    skipped = sum(1 for r in results if r.status == "skipped")
    errors = sum(1 for r in results if r.status == "error")

    return ImportResult(
        success=errors == 0,
        total_items=len(results),
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
        items=results,
    )


@router.post("/backup", response_model=ImportResult)
async def import_backup(
    file: UploadFile = File(...),
    duplicate_handling: DuplicateHandling = DuplicateHandling.SKIP,
    import_categories: bool = True,
    import_poses: bool = True,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Restore from backup file.

    Imports both categories and poses from a backup JSON file.
    """
    # Validate file extension
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a JSON file (.json)",
        )

    # Read and validate file size (streaming)
    content = await validate_file_size(file)

    # Validate MIME type (if python-magic available)
    validate_file_mime_type(content, ".json")

    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid JSON: {str(e)}",
        )

    # Validate backup format
    try:
        backup = BackupData(**data)
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid backup format: {str(e)}",
        )

    results: List[ImportItemResult] = []
    category_cache: Dict[str, Category] = {}

    # Import categories first
    if import_categories and backup.categories:
        for cat_data in backup.categories:
            try:
                category, created = await get_or_create_category(
                    db, current_user.id, cat_data.name, cat_data.description
                )
                category_cache[cat_data.name] = category

                results.append(ImportItemResult(
                    name=cat_data.name,
                    status="created" if created else "skipped",
                    message="Category created" if created else "Category already exists",
                ))
            except Exception as e:
                # Sanitize error message to prevent information disclosure
                results.append(ImportItemResult(
                    name=cat_data.name,
                    status="error",
                    message=sanitize_error_message(e),
                ))

    # Import poses
    if import_poses and backup.poses:
        for pose_data in backup.poses:
            result = await import_single_pose(
                db, current_user.id, pose_data, duplicate_handling, category_cache
            )
            results.append(result)

    # CRITICAL: Commit the transaction to persist changes
    # flush() only sends changes to database but doesn't commit
    await db.commit()

    # Calculate summary
    created = sum(1 for r in results if r.status == "created")
    updated = sum(1 for r in results if r.status == "updated")
    skipped = sum(1 for r in results if r.status == "skipped")
    errors = sum(1 for r in results if r.status == "error")

    return ImportResult(
        success=errors == 0,
        total_items=len(results),
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
        items=results,
    )


@router.post("/preview/json", response_model=ImportPreviewResult)
async def preview_import_json(
    file: UploadFile = File(...),
    duplicate_handling: DuplicateHandling = DuplicateHandling.SKIP,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Preview what will be imported from JSON file without making changes.

    Returns a preview of all items and their expected status.
    Error messages are sanitized to prevent information disclosure.
    """
    # Validate file extension
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a JSON file (.json)",
        )

    # Read and validate file size (streaming)
    content = await validate_file_size(file)

    # Validate MIME type (if python-magic available)
    try:
        validate_file_mime_type(content, ".json")
    except HTTPException as e:
        return ImportPreviewResult(
            valid=False,
            total_items=0,
            poses_count=0,
            categories_count=0,
            will_create=0,
            will_update=0,
            will_skip=0,
            items=[],
            validation_errors=[e.detail],
        )

    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        # Sanitize JSON error message - limit info about internal structure
        error_msg = str(e)
        # Only show basic error info, not detailed position/context
        if "line" in error_msg.lower():
            error_msg = "Invalid JSON syntax"
        return ImportPreviewResult(
            valid=False,
            total_items=0,
            poses_count=0,
            categories_count=0,
            will_create=0,
            will_update=0,
            will_skip=0,
            items=[],
            validation_errors=[f"Invalid JSON: {error_msg}"],
        )

    # Determine format
    poses_data: List[dict] = []
    categories_data: List[dict] = []

    if isinstance(data, list):
        poses_data = data
    elif isinstance(data, dict):
        if "poses" in data:
            poses_data = data.get("poses", [])
            categories_data = data.get("categories", [])

    # Validate and preview
    items: List[ImportPreviewItem] = []
    validation_errors: List[str] = []

    # Preview categories
    for i, cat_dict in enumerate(categories_data):
        try:
            cat = CategoryExport(**cat_dict)
            # Check if exists
            result = await db.execute(
                select(Category).where(
                    and_(
                        func.lower(Category.name) == cat.name.lower(),
                        Category.user_id == current_user.id,
                    )
                )
            )
            exists = result.scalar_one_or_none() is not None

            items.append(ImportPreviewItem(
                name=cat.name,
                type="category",
                exists=exists,
                will_be="skipped" if exists else "created",
            ))
        except ValidationError as e:
            # Sanitize validation error - don't expose field details
            validation_errors.append(f"Category #{i+1}: Invalid format")
        except Exception as e:
            # Sanitize unexpected errors
            validation_errors.append(f"Category #{i+1}: Processing error")
            logger.warning(f"Preview category error: {e}")

    # Preview poses
    for i, pose_dict in enumerate(poses_data):
        try:
            pose = PoseExport(**pose_dict)
            # Check if exists (don't use FOR UPDATE since this is read-only preview)
            existing = await check_pose_exists(db, current_user.id, pose.code, for_update=False)
            exists = existing is not None

            if exists:
                if duplicate_handling == DuplicateHandling.SKIP:
                    will_be = "skipped"
                elif duplicate_handling == DuplicateHandling.OVERWRITE:
                    will_be = "updated"
                else:  # RENAME
                    will_be = "created"
            else:
                will_be = "created"

            items.append(ImportPreviewItem(
                code=pose.code,
                name=pose.name,
                type="pose",
                exists=exists,
                will_be=will_be,
            ))
        except ValidationError as e:
            # Sanitize validation error - provide limited info
            code = pose_dict.get("code", f"#{i+1}")
            validation_errors.append(f"Pose {code}: Invalid format")
        except Exception as e:
            # Sanitize unexpected errors - don't expose SQL or internal details
            code = pose_dict.get("code", f"#{i+1}") if isinstance(pose_dict, dict) else f"#{i+1}"
            validation_errors.append(f"Pose {code}: Processing error")
            logger.warning(f"Preview pose error: {e}")

    # Calculate counts
    poses_count = sum(1 for i in items if i.type == "pose")
    categories_count = sum(1 for i in items if i.type == "category")
    will_create = sum(1 for i in items if i.will_be == "created")
    will_update = sum(1 for i in items if i.will_be == "updated")
    will_skip = sum(1 for i in items if i.will_be == "skipped")

    return ImportPreviewResult(
        valid=len(validation_errors) == 0 and len(items) > 0,
        total_items=len(items),
        poses_count=poses_count,
        categories_count=categories_count,
        will_create=will_create,
        will_update=will_update,
        will_skip=will_skip,
        items=items,
        validation_errors=validation_errors,
    )
