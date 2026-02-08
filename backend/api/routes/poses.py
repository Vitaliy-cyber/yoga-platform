import asyncio
import ipaddress
import logging
import os
import random
import urllib.parse
import uuid
from typing import List, Optional

import config

logger = logging.getLogger(__name__)
from db.database import get_db
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import Response
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User
from schemas.muscle import PoseMuscleResponse
from schemas.pose import (
    PaginatedPoseResponse,
    PoseCreate,
    PoseListResponse,
    PoseResponse,
    PoseUpdate,
)
from services.auth import (
    create_signed_image_url,
    get_current_user,
    verify_signed_image_request,
)
from services.generation_task_utils import (
    clamp_activation_level,
    parse_analyzed_muscles_json,
)
from services.image_validation import (
    MAX_UPLOAD_SIZE_BYTES,
    extension_for_image_mime_type,
    normalize_image_mime_type,
    sniff_image_mime_type,
    validate_uploaded_image_payload,
)
from services.storage import LocalStorage, S3Storage, get_storage
from sqlalchemy import and_, delete, desc, func, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.exc import StaleDataError

router = APIRouter(prefix="/poses", tags=["poses"])

MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE_BYTES

def _parse_trusted_proxy_networks() -> List[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    settings = config.get_settings()
    if not settings.TRUSTED_PROXIES:
        return []
    proxy_strings = [p.strip() for p in settings.TRUSTED_PROXIES.split(",") if p.strip()]
    networks: List[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for proxy in proxy_strings:
        try:
            networks.append(ipaddress.ip_network(proxy, strict=False))
        except ValueError:
            logger.warning("Invalid TRUSTED_PROXIES network: %s", proxy)
    return networks


def _is_trusted_proxy_request(request: Request) -> bool:
    direct_ip = request.client.host if request.client else None
    if not direct_ip:
        return False
    try:
        ip_addr = ipaddress.ip_address(direct_ip)
    except ValueError:
        return False

    networks = _parse_trusted_proxy_networks()
    if networks:
        return any(ip_addr in network for network in networks)

    # SECURITY: Do not trust X-Forwarded-* unless TRUSTED_PROXIES is explicitly set.
    return False


async def save_upload_file(file: UploadFile, subdir: str = "") -> str:
    """Upload file to S3 and return public URL."""
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file uploaded. Please select a valid image file.",
        )
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Max size is 10MB",
        )

    claimed_mime_type = normalize_image_mime_type(file.content_type or "")
    image_info = validate_uploaded_image_payload(
        content, claimed_mime_type=claimed_mime_type or None
    )
    content_type = image_info.mime_type
    ext = extension_for_image_mime_type(content_type)
    if not ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed: PNG, JPG, WEBP",
        )
    filename = f"{uuid.uuid4()}{ext}"

    prefix = f"uploads/{subdir}" if subdir else "uploads"
    key = f"{prefix}/{filename}"

    settings = config.get_settings()
    storage = (
        S3Storage.get_instance() if settings.STORAGE_BACKEND == "s3" else get_storage()
    )
    return await storage.upload_bytes(content, key, content_type)


def build_pose_response(pose: Pose) -> PoseResponse:
    """Побудувати відповідь з пози"""
    muscles = []
    for pm in pose.pose_muscles:
        muscles.append(
            PoseMuscleResponse(
                muscle_id=pm.muscle.id,
                muscle_name=pm.muscle.name,
                muscle_name_ua=pm.muscle.name_ua,
                body_part=pm.muscle.body_part,
                activation_level=pm.activation_level,
            )
        )

    return PoseResponse(
        id=pose.id,
        code=pose.code,
        name=pose.name,
        name_en=pose.name_en,
        category_id=pose.category_id,
        category_name=pose.category.name if pose.category else None,
        # Return raw user-provided text; React escapes at render time.
        # Escaping here breaks UX by showing HTML entities like &quot; and &#x27;.
        description=pose.description,
        effect=pose.effect,
        breathing=pose.breathing,
        schema_path=pose.schema_path,
        photo_path=pose.photo_path,
        muscle_layer_path=pose.muscle_layer_path,
        skeleton_layer_path=pose.skeleton_layer_path,
        # Optimistic locking version - client must send this back on update
        version=pose.version or 1,
        created_at=pose.created_at,
        updated_at=pose.updated_at,
        muscles=muscles,
    )


@router.get("", response_model=PaginatedPoseResponse)
async def get_poses(
    category_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get list of poses for the current user."""
    # Base query for user's poses
    base_query = select(Pose).where(Pose.user_id == current_user.id)

    if category_id:
        base_query = base_query.where(Pose.category_id == category_id)

    # Get paginated items
    query = (
        base_query.options(selectinload(Pose.category))
        .order_by(desc(Pose.created_at), desc(Pose.id))
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    items = [
        PoseListResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            name_en=p.name_en,
            category_id=p.category_id,
            category_name=p.category.name if p.category else None,
            schema_path=p.schema_path,
            photo_path=p.photo_path,
        )
        for p in poses
    ]

    count_query = select(func.count()).select_from(base_query.subquery())
    total = (await db.execute(count_query)).scalar_one()

    return PaginatedPoseResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


def escape_like_pattern(pattern: str) -> str:
    """
    Escape special characters for SQL LIKE patterns.

    SQL LIKE uses % (any sequence), _ (any single char), and \\ (escape).
    These must be escaped to be treated as literals in search queries.
    """
    # Escape backslash first (since it's the escape character)
    pattern = pattern.replace("\\", "\\\\")
    # Escape LIKE wildcards
    pattern = pattern.replace("%", "\\%")
    pattern = pattern.replace("_", "\\_")
    return pattern


@router.get("/search", response_model=List[PoseListResponse])
async def search_poses(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Пошук поз за назвою або кодом"""
    # Escape LIKE special characters to prevent pattern injection
    escaped_query = escape_like_pattern(q)
    search_term = f"%{escaped_query}%"

    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(
            and_(
                Pose.user_id == current_user.id,
                or_(
                    Pose.name.ilike(search_term, escape="\\"),
                    Pose.name_en.ilike(search_term, escape="\\"),
                    Pose.code.ilike(search_term, escape="\\"),
                ),
            )
        )
        .order_by(desc(Pose.created_at), desc(Pose.id))
        .limit(50)
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    return [
        PoseListResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            name_en=p.name_en,
            category_id=p.category_id,
            category_name=p.category.name if p.category else None,
            schema_path=p.schema_path,
            photo_path=p.photo_path,
        )
        for p in poses
    ]


@router.get("/category/{category_id}", response_model=List[PoseListResponse])
async def get_poses_by_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати пози за категорією"""
    # Перевірити чи категорія існує і належить користувачу
    category = await db.execute(
        select(Category).where(
            and_(Category.id == category_id, Category.user_id == current_user.id)
        )
    )
    if not category.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(and_(Pose.category_id == category_id, Pose.user_id == current_user.id))
        .order_by(desc(Pose.created_at), desc(Pose.id))
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    return [
        PoseListResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            name_en=p.name_en,
            category_id=p.category_id,
            category_name=p.category.name if p.category else None,
            schema_path=p.schema_path,
            photo_path=p.photo_path,
        )
        for p in poses
    ]


@router.get("/{pose_id}", response_model=PoseResponse)
async def get_pose(
    pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати позу за ID"""
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
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    return build_pose_response(pose)


@router.get("/code/{code}", response_model=PoseResponse)
async def get_pose_by_code(
    code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати позу за кодом"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.code == code, Pose.user_id == current_user.id))
    )

    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    return build_pose_response(pose)


@router.post("", response_model=PoseResponse, status_code=status.HTTP_201_CREATED)
async def create_pose(
    pose_data: PoseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Створити нову позу"""
    # Перевірка на унікальність коду для цього користувача
    existing = await db.execute(
        select(Pose).where(
            and_(Pose.code == pose_data.code, Pose.user_id == current_user.id)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pose with this code already exists",
        )

    # Перевірка категорії (якщо вказана)
    if pose_data.category_id:
        category = await db.execute(
            select(Category).where(
                and_(
                    Category.id == pose_data.category_id,
                    Category.user_id == current_user.id,
                )
            )
        )
        if not category.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Category not found"
            )

    # Створення пози
    pose_dict = pose_data.model_dump(exclude={"muscles"})
    pose = Pose(user_id=current_user.id, **pose_dict)
    db.add(pose)
    try:
        await db.flush()

        # Додавання м'язів (batch validation to avoid N+1 queries)
        if pose_data.muscles:
            muscle_ids = [m.muscle_id for m in pose_data.muscles]
            result = await db.execute(
                select(Muscle.id).where(Muscle.id.in_(muscle_ids))
            )
            valid_muscle_ids = set(result.scalars().all())

            # Batch create all pose_muscle associations
            pose_muscles_to_add = [
                PoseMuscle(
                    pose_id=pose.id,
                    muscle_id=muscle_data.muscle_id,
                    activation_level=muscle_data.activation_level,
                )
                for muscle_data in pose_data.muscles
                if muscle_data.muscle_id in valid_muscle_ids
            ]
            db.add_all(pose_muscles_to_add)

        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pose with this code already exists",
        )

    # Отримати позу з усіма зв'язками
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose.id)
    )
    result = await db.execute(query)
    pose = result.scalar_one()

    await db.commit()
    return build_pose_response(pose)


@router.put("/{pose_id}", response_model=PoseResponse)
async def update_pose(
    pose_id: int,
    pose_data: PoseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Оновити позу.

    Implements optimistic locking to prevent lost updates:
    - Client must send the current version number
    - If version doesn't match, the update is rejected (409 Conflict)
    - This prevents concurrent edits from overwriting each other

    Uses nested transaction (savepoint) to ensure atomicity:
    - If version creation succeeds but pose update fails, the version is rolled back
    - This prevents orphan versions from being created
    """

    async def apply_update_with_versioning() -> None:
        from services.versioning import versioning_service

        # Use nested transaction (savepoint) for atomic version + update
        # This ensures if the pose update fails, the version is also rolled back
        async with db.begin_nested():
            # Create version snapshot BEFORE making changes
            # This preserves the current state so it can be restored later
            await versioning_service.create_version(
                db,
                pose,
                current_user.id,
                change_note=pose_data.change_note,
                check_for_changes=True,  # Skip if nothing will change
            )

            # Оновлення полів (exclude version from update data - we manage it separately)
            update_data = pose_data.model_dump(
                exclude={
                    "muscles",
                    "analyzed_muscles",
                    "change_note",
                    "version",
                    # SECURITY: Image paths are system-managed (upload/apply-generation),
                    # and must not be user-settable via PUT /poses/{id} (prevents SSRF/proxy).
                    "photo_path",
                    "muscle_layer_path",
                },
                exclude_unset=True,
            )

            # Перевірка на унікальність коду для цього користувача
            if "code" in update_data:
                if update_data["code"] is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Pose code cannot be empty",
                    )
                existing = await db.execute(
                    select(Pose).where(
                        and_(
                            Pose.code == update_data["code"],
                            Pose.user_id == current_user.id,
                            Pose.id != pose_id,
                        )
                    )
                )
                if existing.scalar_one_or_none():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Pose with this code already exists",
                    )

            if "name" in update_data and update_data["name"] is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Pose name cannot be empty",
                )

            # Перевірка категорії (якщо оновлюється)
            if "category_id" in update_data and update_data["category_id"] is not None:
                category = await db.execute(
                    select(Category).where(
                        and_(
                            Category.id == update_data["category_id"],
                            Category.user_id == current_user.id,
                        )
                    )
                )
                if not category.scalar_one_or_none():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Category not found",
                    )

            for field, value in update_data.items():
                setattr(pose, field, value)

            # Оновлення м'язів (за ID) - using batch operations for performance
            if pose_data.muscles is not None:
                # Bulk delete old associations (single DELETE statement)
                await db.execute(
                    delete(PoseMuscle).where(PoseMuscle.pose_id == pose_id)
                )
                # Clear the ORM relationship cache
                pose.pose_muscles.clear()

                # Batch validate muscle IDs (single SELECT instead of N queries)
                muscle_ids = [m.muscle_id for m in pose_data.muscles]
                result = await db.execute(
                    select(Muscle.id).where(Muscle.id.in_(muscle_ids))
                )
                valid_muscle_ids = set(result.scalars().all())

                # Batch create new associations
                pose_muscles_to_add = [
                    PoseMuscle(
                        pose_id=pose.id,
                        muscle_id=muscle_data.muscle_id,
                        activation_level=muscle_data.activation_level,
                    )
                    for muscle_data in pose_data.muscles
                    if muscle_data.muscle_id in valid_muscle_ids
                ]
                db.add_all(pose_muscles_to_add)
                pose.pose_muscles = pose_muscles_to_add

            # Оновлення м'язів за назвою (з AI-аналізу)
            elif pose_data.analyzed_muscles is not None:
                # Bulk delete old associations (single DELETE statement)
                await db.execute(
                    delete(PoseMuscle).where(PoseMuscle.pose_id == pose_id)
                )
                # Clear the ORM relationship cache
                pose.pose_muscles.clear()

                # Batch запит для всіх м'язів (оптимізація N+1)
                muscle_names = [m.name.lower() for m in pose_data.analyzed_muscles]
                result = await db.execute(
                    select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
                )
                muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}

                # Batch create new associations
                pose_muscles_to_add = [
                    PoseMuscle(
                        pose_id=pose.id,
                        muscle_id=muscles_by_name[analyzed.name.lower()].id,
                        activation_level=analyzed.activation_level,
                    )
                    for analyzed in pose_data.analyzed_muscles
                    if analyzed.name.lower() in muscles_by_name
                ]
                db.add_all(pose_muscles_to_add)
                pose.pose_muscles = pose_muscles_to_add

            await db.flush()

    # Get pose with all relationships for versioning
    query = (
        select(Pose)
        .options(selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle))
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # OPTIMISTIC LOCKING: Check version to prevent concurrent edit conflicts
    # If client sends a version, verify it matches current database version
    if pose_data.version is not None:
        current_version = pose.version or 1
        if pose_data.version != current_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Conflict: pose has been modified by another user. "
                f"Your version: {pose_data.version}, current version: {current_version}. "
                f"Please refresh and try again.",
            )

    try:
        await apply_update_with_versioning()
    except (StaleDataError, OperationalError, IntegrityError):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while updating pose. Please retry.",
        )

    # Отримати оновлену позу (outside nested transaction)
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose_id)
    )
    result = await db.execute(query)
    pose = result.scalar_one()

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while updating pose. Please refresh and try again.",
        )
    return build_pose_response(pose)


@router.delete("/{pose_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pose(
    pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Видалити позу"""
    query = select(Pose).where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))

    # Under full-suite E2E stress on SQLite we can hit transient "database is locked".
    # Deleting is idempotent; prefer retry/backoff over leaking a 500.
    max_attempts = 8
    for attempt in range(max_attempts):
        result = await db.execute(query)
        pose = result.scalar_one_or_none()

        if not pose:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
            )

        try:
            await db.delete(pose)
            await db.commit()
            return
        except StaleDataError:
            await db.rollback()
            # Row disappeared between SELECT and DELETE.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
            )
        except OperationalError:
            await db.rollback()
            if attempt >= max_attempts - 1:
                break
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)
            continue
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Conflict while deleting pose. Please retry.",
            )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Conflict while deleting pose. Please retry.",
    )


@router.post("/{pose_id}/schema", response_model=PoseResponse)
async def upload_pose_schema(
    pose_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Завантажити схему для пози"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )
    claimed_mime_type = normalize_image_mime_type(file.content_type or "")
    if (
        claimed_mime_type
        and claimed_mime_type != "application/octet-stream"
        and not claimed_mime_type.startswith("image/")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed: PNG, JPG, WEBP",
        )

    # Save file (upload stream can only be consumed once).
    file_path = await save_upload_file(file, "schemas")

    # Under atomic-suite stress on SQLite, concurrent uploads can hit transient locks.
    # Upload is idempotent-ish (last write wins); return 409/404 instead of leaking 500s.
    max_attempts = 12
    for attempt in range(max_attempts):
        result = await db.execute(query)
        pose = result.scalar_one_or_none()

        if not pose:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
            )

        try:
            pose.schema_path = file_path
            await db.flush()
            await db.commit()
            await db.refresh(pose)
            return build_pose_response(pose)
        except StaleDataError:
            await db.rollback()
            # Row disappeared/changed between SELECT and UPDATE/COMMIT.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
            )
        except (IntegrityError, OperationalError):
            await db.rollback()
            if attempt >= max_attempts - 1:
                break
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)
            continue

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Conflict while uploading schema. Please retry.",
    )


@router.get("/{pose_id}/image/{image_type}")
async def get_pose_image(
    pose_id: int,
    image_type: str,
    current_user: User = Depends(verify_signed_image_request),
    db: AsyncSession = Depends(get_db),
):
    """
    Proxy endpoint to serve S3 images avoiding CORS issues.
    image_type: schema, photo, muscle_layer, skeleton_layer

    Note: This endpoint requires Authorization header. For <img> tags that can't
    send headers, use the S3 presigned URLs returned in pose.photo_path etc.
    """
    # Validate image_type
    valid_types = ["schema", "photo", "muscle_layer", "skeleton_layer"]
    if image_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image type. Must be one of: {valid_types}",
        )

    # Get pose (check user ownership)
    query = select(Pose).where(
        and_(Pose.id == pose_id, Pose.user_id == current_user.id)
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose not found",
        )

    # Get the URL based on image type
    url_map = {
        "schema": pose.schema_path,
        "photo": pose.photo_path,
        "muscle_layer": pose.muscle_layer_path,
        "skeleton_layer": pose.skeleton_layer_path,
    }
    image_url = url_map.get(image_type)

    if not image_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {image_type} image for this pose",
        )

    # Prefer storage backend download to handle private S3 and local files
    storage = get_storage()
    if image_url.startswith("/storage/"):
        storage = LocalStorage.get_instance()

    try:
        # SECURITY: never server-side fetch arbitrary http(s) URLs (SSRF/open proxy).
        if image_url.startswith("http") and isinstance(storage, LocalStorage):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image URL",
            )

        content = await storage.download_bytes(image_url)
        content_type = sniff_image_mime_type(content)
        if not content_type:
            import mimetypes

            content_type, _ = mimetypes.guess_type(image_url.split("?")[0])
        if not content_type:
            content_type = "image/png"

        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Cache-Control": "private, max-age=86400",
            },
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image path",
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch image from storage",
        )


@router.get("/{pose_id}/image/{image_type}/signed-url")
async def get_pose_image_signed_url(
    pose_id: int,
    image_type: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a signed URL for image access in <img> tags."""
    valid_types = ["schema", "photo", "muscle_layer", "skeleton_layer"]
    if image_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image type. Must be one of: {valid_types}",
        )

    query = select(Pose).where(
        and_(Pose.id == pose_id, Pose.user_id == current_user.id)
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose not found",
        )

    url_map = {
        "schema": pose.schema_path,
        "photo": pose.photo_path,
        "muscle_layer": pose.muscle_layer_path,
        "skeleton_layer": pose.skeleton_layer_path,
    }
    image_url = url_map.get(image_type)
    if not image_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {image_type} image for this pose",
        )

    # Signed URL valid for 10 minutes
    query_string = create_signed_image_url(
        pose_id=pose_id,
        image_type=image_type,
        user_id=current_user.id,
        expires_in_seconds=600,
    )
    parsed = dict(urllib.parse.parse_qsl(query_string))
    expires_at = int(parsed.get("expires", "0") or 0)

    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    # SECURITY: Trust proxy headers only when TRUSTED_PROXIES is explicitly configured
    # and the direct peer is a trusted proxy IP. Otherwise ignore to prevent host injection.
    if (forwarded_proto or forwarded_host) and _is_trusted_proxy_request(request):
        scheme = (forwarded_proto or request.url.scheme).split(",")[0].strip()
        host = (
            (forwarded_host or request.headers.get("host") or request.url.netloc)
            .split(",")[0]
            .strip()
        )
        base_url = f"{scheme}://{host}".rstrip("/")
    else:
        # SECURITY: Avoid request.base_url/request.url.scheme here because some deployments
        # (and some ASGI stacks) may reflect X-Forwarded-Proto into scheme even when
        # we are not configured to trust proxy headers.
        settings = config.get_settings()
        host = (request.headers.get("host") or request.url.netloc).split(",")[0].strip()
        scheme = (
            "http"
            if settings.APP_MODE == config.AppMode.DEV
            else request.url.scheme
        )
        base_url = f"{scheme}://{host}".rstrip("/")
    signed_url = f"{base_url}/api/v1/poses/{pose_id}/image/{image_type}?{query_string}"
    if pose.version:
        signed_url = f"{signed_url}&v={pose.version}"

    return {"signed_url": signed_url, "expires_at": expires_at}


@router.post("/{pose_id}/reanalyze-muscles", response_model=PoseResponse)
async def reanalyze_pose_muscles(
    pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Re-analyze muscles for an existing pose using AI.

    This is useful for poses that were saved before muscles were seeded,
    or when you want to update the muscle analysis.
    """
    import os

    from services.google_generator import AnalyzedMuscle, GoogleGeminiGenerator
    from sqlalchemy.exc import IntegrityError, OperationalError
    from sqlalchemy.orm.exc import StaleDataError

    # Get pose with current data
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
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    if not pose.photo_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pose has no generated photo to analyze",
        )

    # Download the photo
    storage = get_storage()
    try:
        photo_bytes = await storage.download_bytes(pose.photo_path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose photo not found",
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pose photo path",
        )
    except Exception:
        logger.exception("Reanalyze: failed to download pose photo (pose_id=%s)", pose_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch pose photo from storage",
        )

    # Analyze muscles using AI
    pose_description = f"{pose.name}"
    if pose.description:
        pose_description += f" - {pose.description}"

    if os.getenv("E2E_FAST_AI") == "1":
        # E2E_FAST_AI is used for Playwright runs; keep this endpoint snappy and deterministic.
        # Return a stable non-empty set so downstream flows (UI, export, versions) can be exercised
        # without waiting on an external LLM call.
        analyzed_muscles = [
            AnalyzedMuscle(name="quadriceps", activation_level=80),
            AnalyzedMuscle(name="gluteus_maximus", activation_level=65),
            AnalyzedMuscle(name="hamstrings", activation_level=55),
            AnalyzedMuscle(name="rectus_abdominis", activation_level=40),
        ]
    else:
        try:
            generator = GoogleGeminiGenerator.get_instance()
            analyzed_muscles = await generator._analyze_muscles_from_image(
                photo_bytes, "image/png", pose_description
            )
        except Exception:
            logger.exception("Reanalyze: muscle analysis failed (pose_id=%s)", pose_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to analyze muscles",
            )

    if not analyzed_muscles:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not identify any muscles in the pose",
        )

    # Delete existing muscle associations
    await db.execute(delete(PoseMuscle).where(PoseMuscle.pose_id == pose.id))

    # Get muscle IDs from database
    muscle_names = [m.name.lower() for m in analyzed_muscles]
    logger.info(f"Reanalyze: looking for muscles: {muscle_names}")

    result = await db.execute(
        select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
    )
    muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}
    logger.info(
        f"Reanalyze: found {len(muscles_by_name)} muscles in database: {list(muscles_by_name.keys())}"
    )

    # Create new muscle associations
    pose_muscles_to_add = [
        PoseMuscle(
            pose_id=pose.id,
            muscle_id=muscles_by_name[m.name.lower()].id,
            activation_level=m.activation_level,
        )
        for m in analyzed_muscles
        if m.name.lower() in muscles_by_name
    ]
    logger.info(
        f"Reanalyze: creating {len(pose_muscles_to_add)} PoseMuscle associations for pose {pose.id}"
    )
    db.add_all(pose_muscles_to_add)

    try:
        await db.flush()
    except (IntegrityError, OperationalError, StaleDataError):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while updating pose muscles. Please retry.",
        )

    # Refresh pose with new muscle data
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose_id)
    )
    result = await db.execute(query)
    pose = result.scalar_one()

    try:
        await db.commit()
    except (IntegrityError, OperationalError, StaleDataError):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while updating pose muscles. Please retry.",
        )
    return build_pose_response(pose)


@router.post("/{pose_id}/apply-generation/{task_id}", response_model=PoseResponse)
async def apply_generation_to_pose(
    pose_id: int,
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Apply generation results to an existing pose.

    This updates the pose with the generated photo and muscle layer,
    and creates PoseMuscle associations from the analyzed muscles.

    Use this after generating from an existing pose to update it
    with the generation results instead of creating a new pose.
    """
    from models.generation_task import GenerationTask

    # IMPORTANT: Don't rely on ORM attributes after rollback(), since SQLAlchemy
    # expires instances on rollback and accessing them can trigger lazy-loads
    # (which may raise MissingGreenlet in async contexts).
    current_user_id = int(current_user.id)

    # Get the pose
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user_id))
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # Get the generation task
    task_result = await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == task_id)
    )
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generation task not found",
        )

    # Verify task belongs to current user
    if task.user_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generation task not found",
        )

    # Verify task is completed
    if task.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Generation task is not completed yet",
        )

    # IMPORTANT: Do not rely on ORM task attributes after rollback()/commit().
    # Async SQLAlchemy expires instances on rollback by default, and accessing expired
    # attributes can trigger implicit IO (which can raise MissingGreenlet).
    task_photo_url = task.photo_url
    task_muscles_url = task.muscles_url
    task_additional_notes = task.additional_notes or ""
    task_analyzed_muscles_json = task.analyzed_muscles_json

    muscles_data_for_apply = parse_analyzed_muscles_json(task_analyzed_muscles_json)
    if muscles_data_for_apply:
        # Defensive cap: never allow unbounded rows from corrupted generator output.
        muscles_data_for_apply = muscles_data_for_apply[:200]

    async def load_pose_for_apply() -> Pose:
        query = (
            select(Pose)
            .options(
                selectinload(Pose.category),
                selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
            )
            .where(and_(Pose.id == pose_id, Pose.user_id == current_user_id))
        )
        result = await db.execute(query)
        p = result.scalar_one_or_none()
        if not p:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
            )
        return p

    async def apply_with_versioning(pose_to_update: Pose) -> None:
        from services.versioning import versioning_service

        # Detect no-op applies (same generated content applied twice).
        # Without this guard, re-applying an already-applied task can create
        # redundant versions even though the pose does not change.
        will_change_photo = bool(
            task_photo_url and task_photo_url != pose_to_update.photo_path
        )
        will_change_muscle_layer = bool(
            task_muscles_url and task_muscles_url != pose_to_update.muscle_layer_path
        )

        planned_pose_muscles: list[PoseMuscle] | None = None
        will_change_muscles = False
        if muscles_data_for_apply is not None:
            try:
                muscle_names = [
                    str(m.get("name", "")).lower()
                    for m in muscles_data_for_apply
                    if isinstance(m, dict) and isinstance(m.get("name"), str)
                ]
                result = await db.execute(
                    select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
                )
                muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}
                logger.info(f"Found {len(muscles_by_name)} muscles in database")

                # IMPORTANT: Deduplicate by muscle_id to avoid IntegrityError on the composite PK
                # (pose_id, muscle_id) when model output contains duplicates.
                dedup_by_muscle_id: dict[int, int] = {}
                for m in muscles_data_for_apply:
                    if not isinstance(m, dict):
                        continue
                    name = m.get("name")
                    if not isinstance(name, str):
                        continue
                    muscle = muscles_by_name.get(name.lower())
                    if not muscle:
                        continue
                    level = clamp_activation_level(m.get("activation_level", 50))
                    prev = dedup_by_muscle_id.get(muscle.id)
                    if prev is None or level > prev:
                        dedup_by_muscle_id[muscle.id] = level

                if not dedup_by_muscle_id:
                    # If the generator output contains only unknown muscle names, preserve the
                    # existing associations rather than wiping them to empty.
                    if muscle_names:
                        logger.warning(
                            f"apply-generation: analyzed_muscles contained no known muscles for pose {pose_id}; preserving existing pose_muscles"
                        )
                    planned_pose_muscles = None
                    will_change_muscles = False
                else:
                    planned_pose_muscles = [
                        PoseMuscle(
                            pose_id=pose_to_update.id,
                            muscle_id=muscle_id,
                            activation_level=level,
                        )
                        for muscle_id, level in sorted(
                            dedup_by_muscle_id.items(), key=lambda x: x[0]
                        )
                    ]

                    incoming_pairs = sorted(dedup_by_muscle_id.items(), key=lambda x: x[0])
                    current_pairs = sorted(
                        (
                            int(pm.muscle_id),
                            int(pm.activation_level or 0),
                        )
                        for pm in (pose_to_update.pose_muscles or [])
                    )
                    will_change_muscles = incoming_pairs != current_pairs
            except (KeyError, TypeError, ValueError, AttributeError) as e:
                logger.warning(f"Failed to prepare analyzed muscles for apply-generation: {e}")
                planned_pose_muscles = None
                will_change_muscles = False

        if not (will_change_photo or will_change_muscle_layer or will_change_muscles):
            logger.info(
                f"apply-generation is a no-op for pose {pose_id} (task {task_id}); skipping version creation"
            )
            return

        # Use nested transaction so if apply fails, version creation is rolled back too.
        async with db.begin_nested():
            note = "AI regeneration applied"
            if task_additional_notes.strip():
                note = f"{note}\n\nNotes: {task_additional_notes.strip()[:500]}"

            await versioning_service.create_version(
                db,
                pose_to_update,
                current_user_id,
                change_note=note,
                check_for_changes=True,
            )

            # Update pose with generation results
            if task_photo_url:
                pose_to_update.photo_path = task_photo_url
                logger.info(
                    f"Applied photo to pose {pose_id}: {task_photo_url[:50]}..."
                )

            if task_muscles_url:
                pose_to_update.muscle_layer_path = task_muscles_url
                logger.info(
                    f"Applied muscle layer to pose {pose_id}: {task_muscles_url[:50]}..."
                )

            # Update muscle associations (only if we found at least one known muscle and the set changes).
            if will_change_muscles and planned_pose_muscles is not None:
                logger.info(f"Applying analyzed muscles to pose {pose_id}")
                pose_to_update.pose_muscles.clear()
                db.add_all(planned_pose_muscles)
                pose_to_update.pose_muscles = planned_pose_muscles
                logger.info(
                    f"Creating {len(planned_pose_muscles)} PoseMuscle associations for pose {pose_id}"
                )

            await db.flush()

    # Apply/commit can hit transient SQLite locks under full-suite E2E stress.
    # Retry/backoff for OperationalError so at least one concurrent apply can succeed.
    max_attempts = 16
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            pose_to_update = await load_pose_for_apply()
            await apply_with_versioning(pose_to_update)

            await db.commit()

            # IMPORTANT: Do not serialize ORM instances loaded before commit.
            # Async SQLAlchemy commonly expires objects on commit; accessing relationships
            # can trigger lazy-loading and raise MissingGreenlet. Reload with eager options.
            query = (
                select(Pose)
                .options(
                    selectinload(Pose.category),
                    selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
                )
                .where(Pose.id == pose_id)
            )
            result = await db.execute(query)
            fresh_pose = result.scalar_one()
            return build_pose_response(fresh_pose)
        except HTTPException:
            raise
        except (OperationalError, StaleDataError, IntegrityError) as e:
            last_err = e
            await db.rollback()
            if attempt >= max_attempts - 1:
                break
            backoff = min(0.05 * (2**attempt), 0.8) + random.random() * 0.05
            await asyncio.sleep(backoff)
            continue
        except SQLAlchemyError as e:
            last_err = e
            await db.rollback()
            # A couple of quick retries can resolve transient ORM/connection races.
            if attempt < 2:
                backoff = 0.05 + random.random() * 0.05
                await asyncio.sleep(backoff)
                continue
            break

    logger.warning(f"apply-generation failed for pose={pose_id} task={task_id}: {last_err}")
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Conflict while applying generation. Please retry.",
    )
