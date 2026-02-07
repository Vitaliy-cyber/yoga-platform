"""
Tests for WebSocket monitoring endpoints.
"""

import pytest
from httpx import AsyncClient

from main import app
from services.websocket_manager import get_connection_manager


@pytest.mark.asyncio
async def test_ws_connections_endpoint_returns_connection_count(client: AsyncClient):
    """Public websocket stats endpoint returns a numeric connection count."""
    response = await client.get("/api/v1/ws/connections")
    assert response.status_code == 200
    data = response.json()
    assert "total_connections" in data
    assert isinstance(data["total_connections"], int)
    assert data["total_connections"] >= 0


@pytest.mark.asyncio
async def test_ws_connections_endpoint_uses_injected_manager(client: AsyncClient):
    """Endpoint should respect dependency-injected connection manager."""

    class FakeManager:
        def get_total_connections(self) -> int:
            return 7

    app.dependency_overrides[get_connection_manager] = lambda: FakeManager()
    try:
        response = await client.get("/api/v1/ws/connections")
        assert response.status_code == 200
        assert response.json() == {"total_connections": 7}
    finally:
        app.dependency_overrides.pop(get_connection_manager, None)
