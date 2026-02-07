"""
Import API routes for yoga-platform.
Provides endpoints for importing poses from JSON, CSV files and restoring backups.
"""

import csv
import io
import json
import logging
import re
import unicodedata
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from db.database import get_db
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User
from pydantic import ValidationError
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
from sqlalchemy import and_, func, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/import", tags=["import"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
CHUNK_SIZE = 64 * 1024  # 64KB chunks for streaming file reads

# Prevent extremely deep JSON from crashing validation / encoding and leaking 500s.
# This is a "defense in depth" guardrail: normal import payloads are shallow.
MAX_JSON_NESTING_DEPTH = 200

# Maximum number of retries for race condition handling.
# Under heavy Playwright atomic stress we can see transient SQLite "database is locked"
# errors. A few extra retries dramatically reduces flakiness without masking real 5xx bugs.
MAX_RETRY_ATTEMPTS = 8

# CSV injection protection characters (formula triggers).
# Export prefixes these with an apostrophe; import should reverse that when safe.
CSV_INJECTION_CHARS = ("=", "+", "-", "@")


def _strip_csv_formula_guard(value: str) -> str:
    """
    Remove CSV formula-guard apostrophes when safe.

    Export prefixes fields that start with formula triggers (=, +, -, @) with
    a single quote to prevent CSV injection. During import, strip that guard
    so round-trips preserve original values. If the original value itself
    started with an apostrophe before a formula trigger (e.g., "'=2+2"),
    export adds a second apostrophe; in that case, drop only one.
    """
    if not isinstance(value, str) or not value.startswith("'"):
        return value

    # Handle escaped leading apostrophe (double apostrophe + formula trigger).
    if value.startswith("''"):
        idx = 2
        while idx < len(value):
            ch = value[idx]
            if ch.isspace() or unicodedata.category(ch) == "Cf":
                idx += 1
                continue
            break
        if idx < len(value) and value[idx] in CSV_INJECTION_CHARS:
            return value[1:]

    idx = 1
    while idx < len(value):
        ch = value[idx]
        if ch.isspace() or unicodedata.category(ch) == "Cf":
            idx += 1
            continue
        break

    if idx < len(value) and value[idx] in CSV_INJECTION_CHARS:
        return value[1:]

    return value


def parse_json_upload_bytes(content: bytes) -> object:
    """
    Decode and parse uploaded JSON bytes.

    SECURITY: never reflect decoder/parser exception text back to clients.
    """
    try:
        # utf-8-sig strips optional UTF-8 BOM, which is common in "Excel-saved" JSON.
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file encoding. Expected UTF-8.",
        )

    try:
        parsed = json.loads(decoded)
    except RecursionError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="JSON nesting too deep.",
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON",
        )

    def _ensure_utf8_encodable(value: object) -> None:
        """
        Reject JSON payloads that contain unpaired surrogates / non-UTF8-encodable text.

        Attack class: JSON allows \\uD800 escapes; Python will materialize them as
        unpaired surrogates. If we persist such strings, later JSON responses can
        crash while encoding to UTF-8 (500).
        """
        stack: List[Tuple[object, int]] = [(value, 0)]
        while stack:
            cur, depth = stack.pop()
            if depth > MAX_JSON_NESTING_DEPTH:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="JSON nesting too deep.",
                )

            if cur is None:
                continue
            if isinstance(cur, (int, float, bool)):
                continue
            if isinstance(cur, str):
                try:
                    cur.encode("utf-8")
                except UnicodeEncodeError:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Invalid Unicode characters in JSON file.",
                    )
                continue
            if isinstance(cur, list):
                stack.extend((v, depth + 1) for v in cur)
                continue
            if isinstance(cur, dict):
                for k, v in cur.items():
                    stack.append((k, depth + 1))
                    stack.append((v, depth + 1))
                continue

    _ensure_utf8_encodable(parsed)
    return parsed


async def safe_commit(db: AsyncSession, action: str) -> None:
    """
    Commit with defensive handling for concurrency issues.

    In E2E / dev we frequently run concurrent imports; SQLite can raise
    transient errors (e.g., locked database) or integrity conflicts.
    Convert those into 409 responses instead of leaking 500s.
    """
    try:
        await db.commit()
    except (IntegrityError, OperationalError):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Conflict while {action}. Please retry.",
        )


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
                decoded = content.decode("utf-8-sig").strip()
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
                content.decode("utf-8-sig")
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
        (
            r"(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|AND|OR)\s+[\w\s,.*=<>]+",
            "[SQL query hidden]",
        ),
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


def _summarize_validation_error(error: ValidationError, max_len: int = 220) -> str:
    """
    Create a concise ValidationError message without echoing large input values.

    SECURITY: Pydantic's stringified ValidationError can include large `input_value`
    snippets and external doc URLs, which can amplify responses and leak more than needed.
    """
    try:
        errors = error.errors()
    except Exception:
        return "Invalid format"

    if not errors:
        return "Invalid format"

    parts: List[str] = []
    for e in errors[:2]:
        loc = e.get("loc")
        msg = e.get("msg") or "Invalid value"
        loc_s = ""
        if isinstance(loc, (list, tuple)) and loc:
            loc_s = ".".join(str(x) for x in loc)
        text = f"{loc_s}: {msg}" if loc_s else str(msg)
        parts.append(sanitize_error_message(Exception(text)))

    summary = "; ".join(parts)
    if len(summary) > max_len:
        return summary[:max_len] + "…"
    return summary


def _strip_invisible_edges(value: str) -> str:
    """
    Strip leading/trailing whitespace and Unicode format characters (Cf).

    This prevents visually-identical names like "\\u200bYoga" or "\\ufeffYoga"
    from bypassing uniqueness and confusing users.
    """
    if not isinstance(value, str):
        return value
    start = 0
    end = len(value)
    while start < end and (
        value[start].isspace() or unicodedata.category(value[start]) == "Cf"
    ):
        start += 1
    while end > start and (
        value[end - 1].isspace() or unicodedata.category(value[end - 1]) == "Cf"
    ):
        end -= 1
    return value[start:end]


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
    # Normalize inputs to match Category schema behavior.
    category_name = _strip_invisible_edges(category_name)
    if not category_name:
        raise ValueError("Category name cannot be blank")
    if len(category_name) > 100:
        raise ValueError("Category name too long")
    if isinstance(description, str):
        description = _strip_invisible_edges(description) or None

    # Check if category exists (Unicode-aware, case-insensitive).
    result = await db.execute(select(Category).where(Category.user_id == user_id))
    target = category_name.casefold()
    existing = next(
        (
            cat
            for cat in result.scalars()
            if isinstance(cat.name, str) and cat.name.casefold() == target
        ),
        None,
    )

    if existing:
        return existing, False

    # Create new category
    new_category = Category(
        user_id=user_id,
        name=category_name,
        description=description,
    )
    try:
        async with db.begin_nested():
            db.add(new_category)
            await db.flush()
    except IntegrityError:
        # Concurrent create: fetch existing and treat as "already exists".
        result = await db.execute(select(Category).where(Category.user_id == user_id))
        existing = next(
            (
                cat
                for cat in result.scalars()
                if isinstance(cat.name, str) and cat.name.casefold() == target
            ),
            None,
        )
        if existing:
            return existing, False
        raise

    return new_category, True


async def get_muscle_by_name(db: AsyncSession, muscle_name: str) -> Optional[Muscle]:
    """Get muscle by name (case-insensitive)."""
    result = await db.execute(
        select(Muscle).where(func.lower(Muscle.name) == muscle_name.lower())
    )
    muscle = result.scalar_one_or_none()
    if muscle:
        return muscle

    # If CSV export prefixed a leading apostrophe to neutralize formula injection,
    # allow a safe fallback lookup without that prefix so round-trips preserve muscles.
    if isinstance(muscle_name, str):
        fallback_name = _strip_csv_formula_guard(muscle_name)
        if fallback_name != muscle_name:
            result = await db.execute(
                select(Muscle).where(func.lower(Muscle.name) == fallback_name.lower())
            )
            return result.scalar_one_or_none()

    return None


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


async def _category_exists_casefold(
    db: AsyncSession,
    user_id: int,
    name: str,
) -> bool:
    normalized = name.strip()
    if not normalized:
        return False
    target = normalized.casefold()
    result = await db.execute(select(Category.name).where(Category.user_id == user_id))
    for existing in result.scalars():
        if not isinstance(existing, str):
            continue
        if existing.casefold() == target:
            return True
    return False


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
        # Savepoint per pose: prevents "transaction aborted" states during
        # concurrent imports from bubbling up as 500s at commit time.
        async with db.begin_nested():
            # Use SELECT FOR UPDATE to prevent race conditions when checking
            # for existing poses with the same code (dialects may ignore it).
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
                        if not await check_pose_exists(
                            db, user_id, new_code, for_update=True
                        ):
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
                normalized_category_name = _strip_invisible_edges(pose_data.category_name)
                if not normalized_category_name:
                    category_id = None
                else:
                    cache_key = normalized_category_name.casefold()
                    if cache_key in category_cache:
                        category_id = category_cache[cache_key].id
                    else:
                        category, _ = await get_or_create_category(
                            db, user_id, normalized_category_name
                        )
                        category_cache[cache_key] = category
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
                        clamped_level = _clamp_activation_level(
                            muscle_data.activation_level
                        )
                        pose_muscle = PoseMuscle(
                            pose_id=existing_pose.id,
                            muscle_id=muscle.id,
                            activation_level=clamped_level,
                        )
                        db.add(pose_muscle)

                await db.flush()

                return ImportItemResult(
                    code=pose_data.code,
                    name=pose_data.name,
                    status="updated",
                    message="Pose updated successfully",
                )

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
                    clamped_level = _clamp_activation_level(
                        muscle_data.activation_level
                    )
                    pose_muscle = PoseMuscle(
                        pose_id=new_pose.id,
                        muscle_id=muscle.id,
                        activation_level=clamped_level,
                    )
                    db.add(pose_muscle)

            await db.flush()

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
            message=f"Validation error: {_summarize_validation_error(e)}",
        )

    except (IntegrityError, OperationalError) as e:
        # Database constraint violation or transient operational failure (e.g. SQLite busy/locked).
        # Treat as a concurrency conflict and retry a few times.
        logger.warning(
            f"Database error importing pose {pose_data.code} (attempt={retry_count + 1}): {e}"
        )

        if retry_count < MAX_RETRY_ATTEMPTS:
            import asyncio
            import random

            # Cap backoff so we don't stall the whole import request for tens of seconds
            # under contention (especially with SQLite busy/locked).
            base = min(0.1 * (2**retry_count), 1.0)  # 0.1s, 0.2s, 0.4s, 0.8s, 1.0s...
            jitter = random.uniform(0, 0.05)
            await asyncio.sleep(base + jitter)
            return await import_single_pose(
                db,
                user_id,
                pose_data,
                duplicate_handling,
                category_cache,
                retry_count + 1,
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
    """
    Parse muscles from CSV format: 'muscle1:level,muscle2:level'.

    Supports escaping inside names using backslashes:
    - '\\,' for literal commas
    - '\\:' for literal colons
    - '\\\\' for literal backslashes
    """
    if not muscles_str or not muscles_str.strip():
        return []

    def _split_unescaped(value: str, sep: str) -> List[str]:
        parts: List[str] = []
        buf: List[str] = []
        i = 0
        while i < len(value):
            ch = value[i]
            if ch == "\\" and i + 1 < len(value):
                nxt = value[i + 1]
                # Preserve escaped separators/backslashes in buffer (unescape later).
                if nxt in {sep, "\\", ":", ","}:
                    buf.append(ch)
                    buf.append(nxt)
                    i += 2
                    continue
            if ch == sep:
                parts.append("".join(buf))
                buf = []
                i += 1
                continue
            buf.append(ch)
            i += 1
        parts.append("".join(buf))
        return parts

    def _unescape_token(value: str) -> str:
        out: List[str] = []
        i = 0
        while i < len(value):
            ch = value[i]
            if ch == "\\" and i + 1 < len(value):
                nxt = value[i + 1]
                if nxt in {",", ":", "\\"}:
                    out.append(nxt)
                    i += 2
                    continue
            out.append(ch)
            i += 1
        return "".join(out)

    muscles: List[MuscleExport] = []
    for pair in _split_unescaped(muscles_str, ","):
        pair = pair.strip()
        if not pair:
            continue

        # Split on the first unescaped colon
        name_part = pair
        level_part: Optional[str] = None
        buf: List[str] = []
        i = 0
        while i < len(pair):
            ch = pair[i]
            if ch == "\\" and i + 1 < len(pair):
                nxt = pair[i + 1]
                if nxt in {":", ",", "\\"}:
                    buf.append(ch)
                    buf.append(nxt)
                    i += 2
                    continue
            if ch == ":":
                name_part = "".join(buf)
                level_part = pair[i + 1 :]
                break
            buf.append(ch)
            i += 1
        if level_part is None:
            name_part = "".join(buf) if buf else pair

        name = _unescape_token(name_part).strip()
        if not name:
            continue

        if level_part is not None:
            try:
                level = int(_unescape_token(level_part).strip())
                level = max(0, min(100, level))  # Clamp to 0-100
                muscles.append(
                    MuscleExport(
                        name=name,
                        activation_level=level,
                    )
                )
            except ValueError:
                continue  # Skip invalid entries
        else:
            muscles.append(
                MuscleExport(
                    name=name,
                    activation_level=50,
                )
            )

    return muscles


def _csv_cell(value: Optional[str], *, required: bool = False) -> str:
    """Normalize a CSV cell and undo formula guards when safe."""
    if value is None:
        if required:
            raise ValueError("Missing required CSV field")
        return ""
    if not isinstance(value, str):
        value = str(value)
    return _strip_csv_formula_guard(value).strip()


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

    data = parse_json_upload_bytes(content)

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
        if not isinstance(pose_dict, dict):
            validation_errors.append(f"Pose #{i + 1}: Invalid pose object")
            continue
        try:
            pose_export = PoseExport(**pose_dict)
            valid_poses.append(pose_export)
        except ValidationError as e:
            validation_errors.append(f"Pose #{i + 1}: {_summarize_validation_error(e)}")
        except (TypeError, ValueError) as e:
            validation_errors.append(f"Pose #{i + 1}: {sanitize_error_message(e)}")

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

    # Commit the transaction to persist changes
    await safe_commit(db, "importing poses from JSON")

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
        # utf-8-sig strips optional UTF-8 BOM, which otherwise breaks header matching
        # (e.g., "\ufeffcode" instead of "code").
        text_content = content.decode("utf-8-sig")
        # Accept large fields up to MAX_FILE_SIZE (we already cap total file size).
        try:
            csv.field_size_limit(MAX_FILE_SIZE)
        except Exception:
            pass
        # Use strict parsing to reject malformed CSV (e.g. unclosed quotes) deterministically.
        # Python's csv module may otherwise accept ambiguous/broken inputs without raising,
        # leading to surprising partial imports.
        try:
            reader = csv.DictReader(io.StringIO(text_content), strict=True)
        except TypeError:
            # Older Python versions may not support strict=.
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
                    code=_csv_cell(row.get("code"), required=True),
                    name=_csv_cell(row.get("name"), required=True),
                    name_en=_csv_cell(row.get("name_en")) or None,
                    category_name=_csv_cell(row.get("category_name")) or None,
                    description=_csv_cell(row.get("description")) or None,
                    effect=_csv_cell(row.get("effect")) or None,
                    breathing=_csv_cell(row.get("breathing")) or None,
                    muscles=muscles,
                )
                valid_poses.append(pose_export)
            except ValidationError as e:
                validation_errors.append(f"Row {i}: {_summarize_validation_error(e)}")
            except Exception as e:
                validation_errors.append(f"Row {i}: {sanitize_error_message(e)}")

    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File encoding error. Please use UTF-8 encoded CSV",
        )
    except csv.Error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid CSV format",
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

    # Commit the transaction to persist changes
    await safe_commit(db, "importing poses from CSV")

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

    data = parse_json_upload_bytes(content)

    # Validate backup format
    try:
        backup = BackupData(**data)
    except ValidationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid backup format",
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
                category_cache[_strip_invisible_edges(cat_data.name).casefold()] = category

                results.append(
                    ImportItemResult(
                        name=cat_data.name,
                        status="created" if created else "skipped",
                        message="Category created"
                        if created
                        else "Category already exists",
                    )
                )
            except Exception as e:
                # Sanitize error message to prevent information disclosure
                results.append(
                    ImportItemResult(
                        name=cat_data.name,
                        status="error",
                        message=sanitize_error_message(e),
                    )
                )

    # Import poses
    if import_poses and backup.poses:
        for pose_data in backup.poses:
            result = await import_single_pose(
                db, current_user.id, pose_data, duplicate_handling, category_cache
            )
            results.append(result)

    # Commit the transaction to persist changes
    await safe_commit(db, "restoring from backup")

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
        data = parse_json_upload_bytes(content)
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
    seen_category_keys: set[str] = set()
    for i, cat_dict in enumerate(categories_data):
        try:
            cat = CategoryExport(**cat_dict)
            normalized_name = _strip_invisible_edges(cat.name)
            if not normalized_name or len(normalized_name) > 100:
                validation_errors.append(f"Category #{i + 1}: Invalid format")
                continue
            key = normalized_name.casefold()

            # If the same category appears multiple times in the uploaded file,
            # preview should reflect that later entries will be skipped.
            if key in seen_category_keys:
                items.append(
                    ImportPreviewItem(
                        name=cat.name,
                        type="category",
                        exists=True,
                        will_be="skipped",
                    )
                )
                continue

            # Check if exists
            exists = await _category_exists_casefold(db, current_user.id, normalized_name)
            seen_category_keys.add(key)

            items.append(
                ImportPreviewItem(
                    name=cat.name,
                    type="category",
                    exists=exists,
                    will_be="skipped" if exists else "created",
                )
            )
        except ValidationError as e:
            # Sanitize validation error - don't expose field details
            validation_errors.append(f"Category #{i + 1}: Invalid format")
        except Exception as e:
            # Sanitize unexpected errors
            validation_errors.append(f"Category #{i + 1}: Processing error")
            logger.warning(f"Preview category error: {e}")

    # Preview poses
    for i, pose_dict in enumerate(poses_data):
        try:
            pose = PoseExport(**pose_dict)
            # Check if exists (don't use FOR UPDATE since this is read-only preview)
            existing = await check_pose_exists(
                db, current_user.id, pose.code, for_update=False
            )
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

            items.append(
                ImportPreviewItem(
                    code=pose.code,
                    name=pose.name,
                    type="pose",
                    exists=exists,
                    will_be=will_be,
                )
            )
        except ValidationError as e:
            # Sanitize validation error - provide limited info
            code = pose_dict.get("code", f"#{i + 1}")
            validation_errors.append(f"Pose {code}: Invalid format")
        except Exception as e:
            # Sanitize unexpected errors - don't expose SQL or internal details
            code = (
                pose_dict.get("code", f"#{i + 1}")
                if isinstance(pose_dict, dict)
                else f"#{i + 1}"
            )
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
