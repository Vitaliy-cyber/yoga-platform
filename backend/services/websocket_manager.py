"""
WebSocket connection manager for real-time generation status updates.

This replaces HTTP polling with WebSocket push notifications for better
performance and user experience:
- No rate limit issues (single persistent connection)
- Real-time updates (no polling interval delay)
- Lower bandwidth and server load
- Better user feedback during generation

Architecture:
- ConnectionManager tracks active WebSocket connections per task_id
- When generation progress updates, broadcast_progress() pushes to all connected clients
- Supports multiple clients watching the same task (e.g., multiple browser tabs)
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class TaskSubscription:
    """Represents a client's subscription to a task's progress updates."""
    websocket: WebSocket
    user_id: int
    task_id: str


@dataclass
class ProgressUpdate:
    """Progress update message to be sent via WebSocket."""
    task_id: str
    status: str
    progress: int
    status_message: Optional[str] = None
    error_message: Optional[str] = None
    photo_url: Optional[str] = None
    muscles_url: Optional[str] = None
    quota_warning: bool = False
    analyzed_muscles: Optional[List[dict]] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "type": "progress_update",
            "task_id": self.task_id,
            "status": self.status,
            "progress": self.progress,
            "status_message": self.status_message,
            "error_message": self.error_message,
            "photo_url": self.photo_url,
            "muscles_url": self.muscles_url,
            "quota_warning": self.quota_warning,
            "analyzed_muscles": self.analyzed_muscles,
        }


class ConnectionManager:
    """
    Manages WebSocket connections for generation task progress updates.

    Thread-safe for use with asyncio. Supports multiple connections per task
    (e.g., multiple browser tabs watching the same generation).

    Usage:
        manager = ConnectionManager()

        # In WebSocket endpoint:
        await manager.connect(websocket, user_id, task_id)
        try:
            while True:
                # Keep connection alive, handle client messages
                data = await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket, task_id)

        # In generation task:
        await manager.broadcast_progress(ProgressUpdate(...))
    """

    def __init__(self):
        # task_id -> set of (websocket, user_id) tuples
        self._subscriptions: Dict[str, Set[tuple]] = {}
        # websocket -> task_id (for fast disconnect lookup)
        self._websocket_tasks: Dict[WebSocket, str] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: int, task_id: str) -> None:
        """
        Register a WebSocket connection for a task.

        Args:
            websocket: The WebSocket connection
            user_id: The authenticated user's ID
            task_id: The generation task ID to subscribe to
        """
        await websocket.accept()

        async with self._lock:
            if task_id not in self._subscriptions:
                self._subscriptions[task_id] = set()

            self._subscriptions[task_id].add((websocket, user_id))
            self._websocket_tasks[websocket] = task_id

        logger.info(f"WebSocket connected: user={user_id}, task={task_id}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """
        Remove a WebSocket connection.

        Args:
            websocket: The WebSocket connection to remove
        """
        async with self._lock:
            task_id = self._websocket_tasks.pop(websocket, None)

            if task_id and task_id in self._subscriptions:
                # Remove the websocket from subscriptions
                self._subscriptions[task_id] = {
                    (ws, uid) for ws, uid in self._subscriptions[task_id]
                    if ws != websocket
                }

                # Clean up empty subscription sets
                if not self._subscriptions[task_id]:
                    del self._subscriptions[task_id]

                logger.info(f"WebSocket disconnected: task={task_id}")

    async def broadcast_progress(self, update: ProgressUpdate) -> int:
        """
        Broadcast a progress update to all clients watching a task.

        Args:
            update: The progress update to broadcast

        Returns:
            Number of clients that received the update
        """
        task_id = update.task_id
        message = json.dumps(update.to_dict())
        sent_count = 0
        failed_connections = []

        async with self._lock:
            subscriptions = self._subscriptions.get(task_id, set()).copy()

        for websocket, user_id in subscriptions:
            try:
                await websocket.send_text(message)
                sent_count += 1
            except Exception as e:
                logger.warning(f"Failed to send WebSocket message to user {user_id}: {e}")
                failed_connections.append(websocket)

        # Clean up failed connections
        for ws in failed_connections:
            await self.disconnect(ws)

        if sent_count > 0:
            logger.debug(f"Broadcast progress to {sent_count} clients: task={task_id}, progress={update.progress}%")

        return sent_count

    async def send_to_user(self, task_id: str, user_id: int, update: ProgressUpdate) -> bool:
        """
        Send a progress update to a specific user watching a task.

        Args:
            task_id: The task ID
            user_id: The user ID to send to
            update: The progress update

        Returns:
            True if message was sent, False otherwise
        """
        message = json.dumps(update.to_dict())

        async with self._lock:
            subscriptions = self._subscriptions.get(task_id, set())

            for websocket, uid in subscriptions:
                if uid == user_id:
                    try:
                        await websocket.send_text(message)
                        return True
                    except Exception as e:
                        logger.warning(f"Failed to send WebSocket message to user {user_id}: {e}")
                        return False

        return False

    def get_connection_count(self, task_id: str) -> int:
        """Get the number of active connections for a task."""
        return len(self._subscriptions.get(task_id, set()))

    def get_total_connections(self) -> int:
        """Get the total number of active WebSocket connections."""
        return len(self._websocket_tasks)

    async def close_task_connections(self, task_id: str) -> int:
        """
        Close all WebSocket connections for a completed/failed task.

        This is called after a task completes to clean up resources.
        Clients should reconnect if they want to watch a new task.

        Args:
            task_id: The task ID

        Returns:
            Number of connections closed
        """
        async with self._lock:
            subscriptions = self._subscriptions.pop(task_id, set())

        closed_count = 0
        for websocket, user_id in subscriptions:
            try:
                await websocket.close(code=1000, reason="Task completed")
                closed_count += 1
            except Exception:
                pass  # Connection may already be closed

            async with self._lock:
                self._websocket_tasks.pop(websocket, None)

        if closed_count > 0:
            logger.info(f"Closed {closed_count} WebSocket connections for completed task: {task_id}")

        return closed_count


# Global connection manager instance
# This is used across the application for WebSocket management
connection_manager = ConnectionManager()


def get_connection_manager() -> ConnectionManager:
    """Get the global connection manager instance."""
    return connection_manager
