"""
WebSocket endpoint for real-time generation status updates.

This replaces HTTP polling with WebSocket push notifications:
- Client connects to ws://host/api/v1/ws/generate/{task_id}
- Server pushes progress updates in real-time
- No rate limiting issues (single persistent connection)
- Better user experience with instant feedback

Authentication:
- JWT token is passed as query parameter: ?token=<access_token>
- Token is validated using the same logic as HTTP endpoints
- Only task owner can subscribe to task updates

Usage (frontend):
    const ws = new WebSocket(`ws://host/api/v1/ws/generate/${taskId}?token=${accessToken}`);

    ws.onmessage = (event) => {
        const update = JSON.parse(event.data);
        // update.type === 'progress_update'
        // update.status, update.progress, update.status_message, etc.
    };

    ws.onclose = (event) => {
        if (event.code === 1000) {
            // Task completed normally
        }
    };
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import AsyncSessionLocal
from models.generation_task import GenerationTask
from models.user import User
from services.auth import is_token_blacklisted, verify_token
from services.websocket_manager import (
    ConnectionManager,
    ProgressUpdate,
    get_connection_manager,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/ws", tags=["websocket"])


async def get_user_from_token(token: str) -> Optional[User]:
    """
    Validate JWT token and return the user.

    This is a WebSocket-specific version of get_current_user that works
    without FastAPI dependencies (since WebSocket doesn't use Depends for query params).
    """
    if not token:
        return None

    payload = verify_token(token.strip(), expected_type="access")
    if payload is None:
        return None

    user_id = payload.get("sub")
    jti = payload.get("jti")

    if user_id is None:
        return None

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return None

    # Check token blacklist and get user from database
    async with AsyncSessionLocal() as db:
        if jti and await is_token_blacklisted(db, jti, log_attempt=False):
            return None

        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()


async def verify_task_ownership(task_id: str, user_id: int) -> bool:
    """
    Verify that the user owns the specified task.

    Returns True if the task exists and belongs to the user.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GenerationTask).where(
                GenerationTask.task_id == task_id,
                GenerationTask.user_id == user_id,
            )
        )
        task = result.scalar_one_or_none()
        return task is not None


async def get_task_current_status(task_id: str, user_id: int) -> Optional[ProgressUpdate]:
    """
    Get the current status of a task for initial WebSocket response.

    Returns None if task doesn't exist or doesn't belong to user.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GenerationTask).where(
                GenerationTask.task_id == task_id,
                GenerationTask.user_id == user_id,
            )
        )
        task = result.scalar_one_or_none()

        if task is None:
            return None

        # Parse analyzed muscles from JSON
        analyzed_muscles = None
        if task.analyzed_muscles_json:
            import json
            try:
                analyzed_muscles = json.loads(task.analyzed_muscles_json)
            except json.JSONDecodeError:
                pass

        return ProgressUpdate(
            task_id=task_id,
            status=task.status,
            progress=task.progress,
            status_message=task.status_message,
            error_message=task.error_message,
            photo_url=task.photo_url,
            muscles_url=task.muscles_url,
            quota_warning=task.quota_warning or False,
            analyzed_muscles=analyzed_muscles,
        )


@router.websocket("/generate/{task_id}")
async def websocket_generation_status(
    websocket: WebSocket,
    task_id: str,
    token: str = Query(..., description="JWT access token"),
    manager: ConnectionManager = Depends(get_connection_manager),
):
    """
    WebSocket endpoint for real-time generation status updates.

    Connection URL: ws://host/api/v1/ws/generate/{task_id}?token=<access_token>

    Messages sent by server:
    {
        "type": "progress_update",
        "task_id": "uuid",
        "status": "pending" | "processing" | "completed" | "failed",
        "progress": 0-100,
        "status_message": "Human readable status",
        "error_message": null | "Error description",
        "photo_url": null | "https://...",
        "muscles_url": null | "https://...",
        "quota_warning": false,
        "analyzed_muscles": null | [{"name": "...", "activation_level": 80}, ...]
    }

    Close codes:
    - 1000: Normal closure (task completed)
    - 1008: Policy violation (unauthorized)
    - 1011: Internal error
    """
    # Authenticate user from token
    user = await get_user_from_token(token)
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token")
        return

    # Verify task ownership
    if not await verify_task_ownership(task_id, user.id):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Task not found or access denied")
        return

    # Connect and register subscription
    await manager.connect(websocket, user.id, task_id)

    try:
        # Send current task status immediately after connection
        current_status = await get_task_current_status(task_id, user.id)
        if current_status:
            import json
            await websocket.send_text(json.dumps(current_status.to_dict()))

            # If task is already completed or failed, close the connection
            if current_status.status in ("completed", "failed"):
                await websocket.close(code=1000, reason=f"Task {current_status.status}")
                return

        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for client messages (ping/pong, or close)
                # We don't expect meaningful messages from client, but need to keep
                # the connection alive and detect disconnects
                data = await websocket.receive_text()

                # Client can send "ping" for keep-alive
                if data == "ping":
                    await websocket.send_text('{"type": "pong"}')

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected by client: user={user.id}, task={task_id}")
                break

    except Exception as e:
        logger.error(f"WebSocket error: user={user.id}, task={task_id}, error={e}")
    finally:
        await manager.disconnect(websocket)


@router.get("/connections")
async def get_websocket_stats(
    manager: ConnectionManager = Depends(get_connection_manager),
):
    """
    Get WebSocket connection statistics (for monitoring/debugging).

    This endpoint is public for health checks but doesn't expose sensitive data.
    """
    return {
        "total_connections": manager.get_total_connections(),
    }
