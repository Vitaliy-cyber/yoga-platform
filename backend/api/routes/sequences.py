"""API routes for yoga pose sequences/complexes."""

from typing import List

from db.database import get_db
from fastapi import APIRouter, Depends, HTTPException, Query, status
from models.pose import Pose
from models.sequence import Sequence, SequencePose
from models.user import User
from schemas.sequence import (
    PaginatedSequenceResponse,
    ReorderPosesRequest,
    SequenceCreate,
    SequenceListResponse,
    SequencePoseCreate,
    SequencePoseResponse,
    SequencePoseUpdate,
    SequenceResponse,
    SequenceUpdate,
)
from services.auth import get_current_user
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/sequences", tags=["sequences"])


def build_sequence_pose_response(sp: SequencePose) -> SequencePoseResponse:
    """Build response for a single sequence pose."""
    return SequencePoseResponse(
        id=sp.id,
        pose_id=sp.pose_id,
        order_index=sp.order_index,
        duration_seconds=sp.duration_seconds,
        transition_note=sp.transition_note,
        pose_name=sp.pose.name,
        pose_code=sp.pose.code,
        pose_photo_path=sp.pose.photo_path,
        pose_schema_path=sp.pose.schema_path,
    )


def build_sequence_response(sequence: Sequence) -> SequenceResponse:
    """Build full response for a sequence with all poses."""
    poses = [build_sequence_pose_response(sp) for sp in sequence.sequence_poses]

    # Calculate total duration - always return a number (0 for empty sequences)
    # Handle None values in duration_seconds to prevent TypeError when summing
    total_duration = sum(
        (sp.duration_seconds or 0) for sp in sequence.sequence_poses
    )

    # Use calculated total if we have poses, otherwise use stored duration or default to 0
    final_duration = total_duration if total_duration > 0 else (sequence.duration_seconds or 0)

    return SequenceResponse(
        id=sequence.id,
        user_id=sequence.user_id,
        name=sequence.name,
        description=sequence.description,
        difficulty=sequence.difficulty,
        duration_seconds=final_duration,
        created_at=sequence.created_at,
        updated_at=sequence.updated_at,
        poses=poses,
    )


def build_sequence_list_response(sequence: Sequence, pose_count: int, total_duration: int) -> SequenceListResponse:
    """Build list response for a sequence."""
    return SequenceListResponse(
        id=sequence.id,
        name=sequence.name,
        description=sequence.description,
        difficulty=sequence.difficulty,
        duration_seconds=total_duration or 0,
        pose_count=pose_count,
        created_at=sequence.created_at,
        updated_at=sequence.updated_at,
    )


@router.get("", response_model=PaginatedSequenceResponse)
async def get_sequences(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated list of sequences for current user."""
    # Get total count
    count_query = select(func.count(Sequence.id)).where(
        Sequence.user_id == current_user.id
    )
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get sequences with pose count and total duration
    query = (
        select(
            Sequence,
            func.count(SequencePose.id).label("pose_count"),
            func.coalesce(func.sum(SequencePose.duration_seconds), 0).label("total_duration")
        )
        .outerjoin(SequencePose, Sequence.id == SequencePose.sequence_id)
        .where(Sequence.user_id == current_user.id)
        .group_by(Sequence.id)
        .order_by(Sequence.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()

    items = [
        build_sequence_list_response(row[0], row[1], row[2])
        for row in rows
    ]

    return PaginatedSequenceResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("", response_model=SequenceResponse, status_code=status.HTTP_201_CREATED)
async def create_sequence(
    sequence_data: SequenceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new sequence."""
    # Create the sequence
    sequence = Sequence(
        user_id=current_user.id,
        name=sequence_data.name,
        description=sequence_data.description,
        difficulty=sequence_data.difficulty,
    )
    db.add(sequence)
    await db.flush()

    # Add poses if provided
    if sequence_data.poses:
        for pose_data in sequence_data.poses:
            # Verify pose belongs to user
            pose_result = await db.execute(
                select(Pose).where(
                    and_(
                        Pose.id == pose_data.pose_id,
                        Pose.user_id == current_user.id,
                    )
                )
            )
            pose = pose_result.scalar_one_or_none()
            if not pose:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Pose with id {pose_data.pose_id} not found",
                )

            sequence_pose = SequencePose(
                sequence_id=sequence.id,
                pose_id=pose_data.pose_id,
                order_index=pose_data.order_index,
                duration_seconds=pose_data.duration_seconds,
                transition_note=pose_data.transition_note,
            )
            db.add(sequence_pose)

    await db.flush()
    await db.commit()

    # Reload with relationships
    query = (
        select(Sequence)
        .options(
            selectinload(Sequence.sequence_poses).selectinload(SequencePose.pose)
        )
        .where(Sequence.id == sequence.id)
    )
    result = await db.execute(query)
    sequence = result.scalar_one()

    return build_sequence_response(sequence)


@router.get("/{sequence_id}", response_model=SequenceResponse)
async def get_sequence(
    sequence_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a sequence by ID with all poses."""
    query = (
        select(Sequence)
        .options(
            selectinload(Sequence.sequence_poses).selectinload(SequencePose.pose)
        )
        .where(
            and_(
                Sequence.id == sequence_id,
                Sequence.user_id == current_user.id,
            )
        )
    )

    result = await db.execute(query)
    sequence = result.scalar_one_or_none()

    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sequence not found",
        )

    return build_sequence_response(sequence)


@router.put("/{sequence_id}", response_model=SequenceResponse)
async def update_sequence(
    sequence_id: int,
    sequence_data: SequenceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a sequence's metadata."""
    query = select(Sequence).where(
        and_(
            Sequence.id == sequence_id,
            Sequence.user_id == current_user.id,
        )
    )
    result = await db.execute(query)
    sequence = result.scalar_one_or_none()

    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sequence not found",
        )

    # Update fields
    update_data = sequence_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(sequence, field, value)

    await db.flush()
    await db.commit()

    # Reload with relationships
    query = (
        select(Sequence)
        .options(
            selectinload(Sequence.sequence_poses).selectinload(SequencePose.pose)
        )
        .where(Sequence.id == sequence_id)
    )
    result = await db.execute(query)
    sequence = result.scalar_one()

    return build_sequence_response(sequence)


@router.delete("/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sequence(
    sequence_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a sequence."""
    query = select(Sequence).where(
        and_(
            Sequence.id == sequence_id,
            Sequence.user_id == current_user.id,
        )
    )
    result = await db.execute(query)
    sequence = result.scalar_one_or_none()

    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sequence not found",
        )

    await db.delete(sequence)
    await db.commit()


@router.post("/{sequence_id}/poses", response_model=SequenceResponse)
async def add_pose_to_sequence(
    sequence_id: int,
    pose_data: SequencePoseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a pose to a sequence."""
    # Verify sequence belongs to user
    query = select(Sequence).where(
        and_(
            Sequence.id == sequence_id,
            Sequence.user_id == current_user.id,
        )
    )
    result = await db.execute(query)
    sequence = result.scalar_one_or_none()

    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sequence not found",
        )

    # Verify pose belongs to user
    pose_result = await db.execute(
        select(Pose).where(
            and_(
                Pose.id == pose_data.pose_id,
                Pose.user_id == current_user.id,
            )
        )
    )
    pose = pose_result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pose not found",
        )

    # Get max order_index to validate and potentially auto-assign
    max_order_result = await db.execute(
        select(func.max(SequencePose.order_index))
        .where(SequencePose.sequence_id == sequence_id)
    )
    max_order = max_order_result.scalar()
    max_order = max_order if max_order is not None else -1

    # If order_index is 0 (default), append at the end
    if pose_data.order_index == 0:
        order_index = max_order + 1
    else:
        # Validate order_index is within valid range (0 to max_order + 1)
        if pose_data.order_index < 0 or pose_data.order_index > max_order + 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"order_index must be between 0 and {max_order + 1}",
            )
        order_index = pose_data.order_index

    # Use nested transaction for atomic shift + insert
    # This ensures if the insert fails, the shifted indices are rolled back
    try:
        async with db.begin_nested():
            # Shift existing poses to make room if inserting in the middle
            if order_index <= max_order:
                shift_result = await db.execute(
                    select(SequencePose)
                    .where(
                        and_(
                            SequencePose.sequence_id == sequence_id,
                            SequencePose.order_index >= order_index,
                        )
                    )
                    .order_by(SequencePose.order_index.desc())
                )
                poses_to_shift = shift_result.scalars().all()
                for sp in poses_to_shift:
                    sp.order_index += 1

            # Create sequence pose
            sequence_pose = SequencePose(
                sequence_id=sequence_id,
                pose_id=pose_data.pose_id,
                order_index=order_index,
                duration_seconds=pose_data.duration_seconds,
                transition_note=pose_data.transition_note,
            )
            db.add(sequence_pose)
            await db.flush()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add pose to sequence: {str(e)}",
        )

    await db.commit()

    # Reload with relationships
    query = (
        select(Sequence)
        .options(
            selectinload(Sequence.sequence_poses).selectinload(SequencePose.pose)
        )
        .where(Sequence.id == sequence_id)
    )
    result = await db.execute(query)
    sequence = result.scalar_one()

    return build_sequence_response(sequence)


@router.put("/{sequence_id}/poses/reorder", response_model=SequenceResponse)
async def reorder_sequence_poses(
    sequence_id: int,
    reorder_data: ReorderPosesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Reorder poses in a sequence by providing the new order of pose IDs.

    Uses a nested transaction (savepoint) to ensure atomicity:
    - All order index updates happen in a single atomic operation
    - If any update fails, all changes are rolled back
    - Prevents inconsistent intermediate states
    """
    # Verify sequence belongs to user
    query = (
        select(Sequence)
        .options(selectinload(Sequence.sequence_poses))
        .where(
            and_(
                Sequence.id == sequence_id,
                Sequence.user_id == current_user.id,
            )
        )
    )
    result = await db.execute(query)
    sequence = result.scalar_one_or_none()

    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sequence not found",
        )

    # Create a map of sequence_pose_id to sequence_pose
    sp_map = {sp.id: sp for sp in sequence.sequence_poses}
    existing_ids = set(sp_map.keys())
    provided_ids = set(reorder_data.pose_ids)

    # Check for duplicates in the request
    if len(reorder_data.pose_ids) != len(provided_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Duplicate pose IDs are not allowed in reorder request",
        )

    # Validate that ALL pose IDs are provided (no partial reordering)
    if provided_ids != existing_ids:
        missing_ids = existing_ids - provided_ids
        extra_ids = provided_ids - existing_ids
        if extra_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sequence pose IDs {sorted(extra_ids)} not found in this sequence",
            )
        if missing_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"All pose IDs must be provided. Missing: {sorted(missing_ids)}",
            )

    # Use nested transaction (savepoint) for atomic reordering
    # This ensures all order index updates succeed together or fail together
    try:
        async with db.begin_nested():
            # Update order indices atomically
            for new_index, sp_id in enumerate(reorder_data.pose_ids):
                sp_map[sp_id].order_index = new_index

            await db.flush()
    except Exception as e:
        # Nested transaction automatically rolls back on exception
        # Re-raise with user-friendly message
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reorder poses: {str(e)}",
        )

    await db.commit()

    # Reload with relationships
    query = (
        select(Sequence)
        .options(
            selectinload(Sequence.sequence_poses).selectinload(SequencePose.pose)
        )
        .where(Sequence.id == sequence_id)
    )
    result = await db.execute(query)
    sequence = result.scalar_one()

    return build_sequence_response(sequence)


@router.delete("/{sequence_id}/poses/{sequence_pose_id}", response_model=SequenceResponse)
async def remove_pose_from_sequence(
    sequence_id: int,
    sequence_pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a pose from a sequence."""
    # Verify sequence belongs to user
    query = select(Sequence).where(
        and_(
            Sequence.id == sequence_id,
            Sequence.user_id == current_user.id,
        )
    )
    result = await db.execute(query)
    sequence = result.scalar_one_or_none()

    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sequence not found",
        )

    # Find the sequence pose
    sp_result = await db.execute(
        select(SequencePose).where(
            and_(
                SequencePose.id == sequence_pose_id,
                SequencePose.sequence_id == sequence_id,
            )
        )
    )
    sequence_pose = sp_result.scalar_one_or_none()

    if not sequence_pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose not found in this sequence",
        )

    # Use nested transaction for atomic delete + reorder
    # This ensures the delete and reindex happen together or not at all
    try:
        async with db.begin_nested():
            # Delete the sequence pose
            await db.delete(sequence_pose)
            await db.flush()

            # Reorder remaining poses
            remaining_result = await db.execute(
                select(SequencePose)
                .where(SequencePose.sequence_id == sequence_id)
                .order_by(SequencePose.order_index)
            )
            remaining_poses = remaining_result.scalars().all()

            for new_index, sp in enumerate(remaining_poses):
                sp.order_index = new_index

            await db.flush()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to remove pose from sequence: {str(e)}",
        )

    await db.commit()

    # Reload with relationships
    query = (
        select(Sequence)
        .options(
            selectinload(Sequence.sequence_poses).selectinload(SequencePose.pose)
        )
        .where(Sequence.id == sequence_id)
    )
    result = await db.execute(query)
    sequence = result.scalar_one()

    return build_sequence_response(sequence)


@router.put("/{sequence_id}/poses/{sequence_pose_id}", response_model=SequenceResponse)
async def update_sequence_pose(
    sequence_id: int,
    sequence_pose_id: int,
    pose_update: SequencePoseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a pose's duration or transition note in a sequence."""
    # Verify sequence belongs to user
    query = select(Sequence).where(
        and_(
            Sequence.id == sequence_id,
            Sequence.user_id == current_user.id,
        )
    )
    result = await db.execute(query)
    sequence = result.scalar_one_or_none()

    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sequence not found",
        )

    # Find the sequence pose
    sp_result = await db.execute(
        select(SequencePose).where(
            and_(
                SequencePose.id == sequence_pose_id,
                SequencePose.sequence_id == sequence_id,
            )
        )
    )
    sequence_pose = sp_result.scalar_one_or_none()

    if not sequence_pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose not found in this sequence",
        )

    # Update fields only if provided (SequencePoseUpdate has optional fields)
    if pose_update.duration_seconds is not None:
        sequence_pose.duration_seconds = pose_update.duration_seconds
    if pose_update.transition_note is not None:
        sequence_pose.transition_note = pose_update.transition_note

    await db.flush()
    await db.commit()

    # Reload with relationships
    query = (
        select(Sequence)
        .options(
            selectinload(Sequence.sequence_poses).selectinload(SequencePose.pose)
        )
        .where(Sequence.id == sequence_id)
    )
    result = await db.execute(query)
    sequence = result.scalar_one()

    return build_sequence_response(sequence)
