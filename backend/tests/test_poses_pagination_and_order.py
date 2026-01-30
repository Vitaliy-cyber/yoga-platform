import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_poses_newest_first(auth_client: AsyncClient):
    create1 = await auth_client.post(
        "/api/poses", json={"code": "ORD01", "name": "Order One"}
    )
    create2 = await auth_client.post(
        "/api/poses", json={"code": "ORD02", "name": "Order Two"}
    )
    create3 = await auth_client.post(
        "/api/poses", json={"code": "ORD03", "name": "Order Three"}
    )
    assert create1.status_code == 201
    assert create2.status_code == 201
    assert create3.status_code == 201

    response = await auth_client.get("/api/poses")
    assert response.status_code == 200
    items = response.json()["items"]
    assert items[0]["id"] > items[1]["id"] > items[2]["id"]
