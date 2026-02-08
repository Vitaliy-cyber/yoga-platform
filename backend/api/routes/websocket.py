"""
WebSocket endpoint for real-time generation status updates.

This replaces HTTP polling with WebSocket push notifications:
- Client connects to ws://host/api/v1/ws/generate/{task_id}
- Server pushes progress updates in real-time
- No rate limiting issues (single persistent connection)
- Better user experience with instant feedback

Authentication:
- JWT token is passed via WebSocket subprotocol to avoid leaking tokens in URLs/logs.
- Token is validated using the same logic as HTTP endpoints
- Only task owner can subscribe to task updates

Usage (frontend):
    const ws = new WebSocket(`ws://host/api/v1/ws/generate/${taskId}`, ['jwt', accessToken]);

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

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from config import get_settings
from db.database import AsyncSessionLocal
from models.generation_task import GenerationTask
from models.user import User
from services.auth import decode_token, is_token_blacklisted
from services.error_sanitizer import sanitize_public_error_message
from services.generation_task_utils import (
    clamp_progress,
    normalize_generate_status,
    parse_analyzed_muscles_json,
)
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

    payload = decode_token(token.strip(), expected_type="access")
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

        analyzed_muscles = parse_analyzed_muscles_json(task.analyzed_muscles_json)
        progress_int = clamp_progress(task.progress or 0)
        status_value = normalize_generate_status(task.status, default="failed")

        return ProgressUpdate(
            task_id=task_id,
            status=status_value,
            progress=progress_int,
            status_message=task.status_message,
            error_message=sanitize_public_error_message(
                task.error_message, fallback="Generation failed"
            ),
            photo_url=task.photo_url,
            muscles_url=task.muscles_url,
            quota_warning=task.quota_warning or False,
            analyzed_muscles=analyzed_muscles,
        )


@router.websocket("/generate/{task_id}")
async def websocket_generation_status(
    websocket: WebSocket,
    task_id: str,
    token: str | None = Query(
        None,
        description="DEPRECATED: JWT access token in query. Prefer Sec-WebSocket-Protocol: jwt,<token>.",
    ),
    manager: ConnectionManager = Depends(get_connection_manager),
):
    """
    WebSocket endpoint for real-time generation status updates.

    Connection URL: ws://host/api/v1/ws/generate/{task_id}

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
    # SECURITY: Prefer passing access token via Sec-WebSocket-Protocol to avoid URL/log leaks.
    # Client should connect with: new WebSocket(url, ['jwt', accessToken])
    chosen_subprotocol: str | None = None
    token_value = (token or "").strip()
    if not token_value:
        raw_protocols = websocket.headers.get("sec-websocket-protocol") or ""
        protocols = [p.strip() for p in raw_protocols.split(",") if p.strip()]
        if len(protocols) >= 2 and protocols[0].lower() == "jwt":
            token_value = protocols[1].strip()
            chosen_subprotocol = "jwt"
        else:
            # Best-effort: accept a JWT-looking token as any offered subprotocol item.
            for p in protocols:
                if p.count(".") >= 2 and len(p) > 32:
                    token_value = p
                    chosen_subprotocol = protocols[0] if protocols else None
                    break

    # Authenticate user from token (query fallback is allowed but discouraged).
    user = await get_user_from_token(token_value)
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token")
        return

    # Verify task ownership
    if not await verify_task_ownership(task_id, user.id):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Task not found or access denied")
        return

    # Connect and register subscription
    await manager.connect(websocket, user.id, task_id, subprotocol=chosen_subprotocol)

    try:
        # Send current task status immediately after connection
        terminal_status_sent = False
        current_status = await get_task_current_status(task_id, user.id)
        if current_status:
            import json
            await websocket.send_text(json.dumps(current_status.to_dict()))

            # For terminal tasks, let the client close first. Immediate server-side
            # close can trigger reconnect loops in some proxy/browser combinations.
            if current_status.status in ("completed", "failed"):
                terminal_status_sent = True

        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for client messages (ping/pong, or close)
                # We don't expect meaningful messages from client, but need to keep
                # the connection alive and detect disconnects
                if terminal_status_sent:
                    # Terminal task: short grace window for client-side close.
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=5)
                else:
                    data = await websocket.receive_text()

                # Client can send "ping" for keep-alive
                if data == "ping":
                    await websocket.send_text('{"type": "pong"}')

            except asyncio.TimeoutError:
                try:
                    await websocket.close(code=1000, reason="Terminal status delivered")
                except Exception:
                    pass
                break
            except WebSocketDisconnect:
                logger.debug(f"WebSocket disconnected by client: user={user.id}, task={task_id}")
                break

    except WebSocketDisconnect:
        logger.debug(f"WebSocket disconnected: user={user.id}, task={task_id}")
    except Exception as e:
        logger.error(
            "WebSocket error: user=%s, task=%s, error_type=%s, error=%s",
            user.id, task_id, type(e).__name__, e,
        )
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
