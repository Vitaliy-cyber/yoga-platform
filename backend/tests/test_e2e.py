"""
E2E тести для Yoga Platform API

Тестує повний флоу роботи з API:
- Категорії
- М'язи
- Пози
- Генерація (mock)
"""

import io

import pytest
from httpx import AsyncClient


class TestHealthAndInfo:
    """Тести базових ендпоінтів"""

    @pytest.mark.asyncio
    async def test_health_check(self, auth_client: AsyncClient):
        response = await auth_client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "mode" in data
        assert "ai_enabled" in data

    @pytest.mark.asyncio
    async def test_root_endpoint(self, auth_client: AsyncClient):
        response = await auth_client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Yoga Pose Platform API"
        assert "version" in data

    @pytest.mark.asyncio
    async def test_api_info(self, auth_client: AsyncClient):
        response = await auth_client.get("/api/info")
        assert response.status_code == 200
        data = response.json()
        assert "features" in data
        assert "endpoints" in data


class TestCategoriesE2E:
    """E2E тести для категорій"""

    @pytest.mark.asyncio
    async def test_full_category_lifecycle(self, auth_client: AsyncClient):
        """Тест повного життєвого циклу категорії: створення -> читання -> оновлення -> видалення"""

        # 1. Створення категорії
        create_response = await auth_client.post(
            "/api/categories",
            json={"name": "Прогини", "description": "Пози з прогином спини"},
        )
        assert create_response.status_code == 201
        category = create_response.json()
        assert category["name"] == "Прогини"
        assert category["description"] == "Пози з прогином спини"
        category_id = category["id"]

        # 2. Отримання категорії
        get_response = await auth_client.get(f"/api/categories/{category_id}")
        assert get_response.status_code == 200
        assert get_response.json()["name"] == "Прогини"

        # 3. Отримання списку категорій
        list_response = await auth_client.get("/api/categories")
        assert list_response.status_code == 200
        categories = list_response.json()
        assert len(categories) >= 1
        assert any(c["id"] == category_id for c in categories)

        # 4. Оновлення категорії
        update_response = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "Прогини спини", "description": "Оновлений опис"},
        )
        assert update_response.status_code == 200
        updated = update_response.json()
        assert updated["name"] == "Прогини спини"
        assert updated["description"] == "Оновлений опис"

        # 5. Видалення категорії
        delete_response = await auth_client.delete(f"/api/categories/{category_id}")
        assert delete_response.status_code == 204

        # 6. Перевірка що категорія видалена
        get_deleted = await auth_client.get(f"/api/categories/{category_id}")
        assert get_deleted.status_code == 404

    @pytest.mark.asyncio
    async def test_category_duplicate_name(self, auth_client: AsyncClient):
        """Тест на унікальність назви категорії"""

        # Створюємо першу категорію
        await auth_client.post("/api/categories", json={"name": "Унікальна"})

        # Спроба створити з тією ж назвою
        response = await auth_client.post("/api/categories", json={"name": "Унікальна"})
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]


class TestMusclesE2E:
    """E2E тести для м'язів"""

    @pytest.mark.asyncio
    async def test_seed_and_list_muscles(self, auth_client: AsyncClient):
        """Тест заповнення та отримання м'язів"""

        # Seed м'язів
        seed_response = await auth_client.post("/api/muscles/seed")
        assert seed_response.status_code == 200
        seeded = seed_response.json()
        assert len(seeded) > 0

        # Отримання всіх м'язів
        list_response = await auth_client.get("/api/muscles")
        assert list_response.status_code == 200
        muscles = list_response.json()
        assert len(muscles) >= len(seeded)

        # Перевірка структури
        muscle = muscles[0]
        assert "id" in muscle
        assert "name" in muscle
        assert "name_ua" in muscle
        assert "body_part" in muscle

    @pytest.mark.asyncio
    async def test_filter_muscles_by_body_part(self, auth_client: AsyncClient):
        """Тест фільтрації м'язів по частині тіла"""

        # Спочатку seed
        await auth_client.post("/api/muscles/seed")

        # Фільтрація по спині
        response = await auth_client.get("/api/muscles", params={"body_part": "back"})
        assert response.status_code == 200
        muscles = response.json()

        # Всі м'язи повинні бути з категорії 'back'
        for muscle in muscles:
            assert muscle["body_part"] == "back"

    @pytest.mark.asyncio
    async def test_get_muscle_by_id(self, auth_client: AsyncClient):
        """Тест отримання м'яза по ID"""

        # Seed
        seed_response = await auth_client.post("/api/muscles/seed")
        muscles = seed_response.json()

        if muscles:
            muscle_id = muscles[0]["id"]
            response = await auth_client.get(f"/api/muscles/{muscle_id}")
            assert response.status_code == 200
            assert response.json()["id"] == muscle_id


class TestPosesE2E:
    """E2E тести для поз"""

    @pytest.mark.asyncio
    async def test_full_pose_lifecycle(self, auth_client: AsyncClient):
        """Тест повного життєвого циклу пози"""

        # 1. Створюємо категорію
        cat_response = await auth_client.post(
            "/api/categories", json={"name": "Баланс"}
        )
        category_id = cat_response.json()["id"]

        # 2. Seed м'язів
        await auth_client.post("/api/muscles/seed")
        muscles_response = await auth_client.get("/api/muscles")
        muscles = muscles_response.json()

        # 3. Створюємо позу
        pose_data = {
            "code": "001",
            "name": "Дерево",
            "name_en": "Tree Pose",
            "category_id": category_id,
            "description": "Стійка на одній нозі з руками вгору",
            "effect": "Покращує баланс та концентрацію",
            "breathing": "Рівномірне глибоке дихання",
            "muscles": [
                {"muscle_id": muscles[0]["id"], "activation_level": 80},
                {"muscle_id": muscles[1]["id"], "activation_level": 60},
            ]
            if len(muscles) >= 2
            else [],
        }

        create_response = await auth_client.post("/api/poses", json=pose_data)
        assert create_response.status_code == 201
        pose = create_response.json()
        assert pose["code"] == "001"
        assert pose["name"] == "Дерево"
        assert pose["category_name"] == "Баланс"
        pose_id = pose["id"]

        # 4. Отримання пози
        get_response = await auth_client.get(f"/api/poses/{pose_id}")
        assert get_response.status_code == 200
        fetched = get_response.json()
        assert fetched["name"] == "Дерево"
        assert len(fetched["muscles"]) == len(pose_data["muscles"])

        # 5. Отримання по коду
        code_response = await auth_client.get("/api/poses/code/001")
        assert code_response.status_code == 200
        assert code_response.json()["id"] == pose_id

        # 6. Пошук
        search_response = await auth_client.get(
            "/api/poses/search", params={"q": "Дерево"}
        )
        assert search_response.status_code == 200
        results = search_response.json()
        assert len(results) >= 1
        assert any(p["id"] == pose_id for p in results)

        # 7. Оновлення
        update_response = await auth_client.put(
            f"/api/poses/{pose_id}",
            json={"name": "Дерево (Врікшасана)", "effect": "Оновлений ефект"},
        )
        assert update_response.status_code == 200
        assert update_response.json()["name"] == "Дерево (Врікшасана)"

        # 8. Видалення
        delete_response = await auth_client.delete(f"/api/poses/{pose_id}")
        assert delete_response.status_code == 204

        # 9. Перевірка видалення
        get_deleted = await auth_client.get(f"/api/poses/{pose_id}")
        assert get_deleted.status_code == 404

    @pytest.mark.asyncio
    async def test_poses_by_category(self, auth_client: AsyncClient):
        """Тест отримання поз по категорії"""

        # Створюємо категорії
        cat1 = await auth_client.post("/api/categories", json={"name": "Стоячі"})
        cat2 = await auth_client.post("/api/categories", json={"name": "Сидячі"})
        cat1_id = cat1.json()["id"]
        cat2_id = cat2.json()["id"]

        # Створюємо пози
        await auth_client.post(
            "/api/poses", json={"code": "S01", "name": "Гора", "category_id": cat1_id}
        )
        await auth_client.post(
            "/api/poses", json={"code": "S02", "name": "Воїн", "category_id": cat1_id}
        )
        await auth_client.post(
            "/api/poses", json={"code": "L01", "name": "Лотос", "category_id": cat2_id}
        )

        # Отримуємо пози категорії "Стоячі"
        response = await auth_client.get(f"/api/poses/category/{cat1_id}")
        assert response.status_code == 200
        poses = response.json()
        assert len(poses) == 2
        assert all(p["category_id"] == cat1_id for p in poses)

    @pytest.mark.asyncio
    async def test_pose_duplicate_code(self, auth_client: AsyncClient):
        """Тест на унікальність коду пози"""

        await auth_client.post("/api/poses", json={"code": "DUP01", "name": "Перша"})

        response = await auth_client.post(
            "/api/poses", json={"code": "DUP01", "name": "Друга"}
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_pose_search_multiple_fields(self, auth_client: AsyncClient):
        """Тест пошуку по різних полях"""

        await auth_client.post(
            "/api/poses",
            json={"code": "WAR01", "name": "Воїн Один", "name_en": "Warrior One"},
        )

        # Пошук по українській назві
        response1 = await auth_client.get("/api/poses/search", params={"q": "Воїн"})
        assert response1.status_code == 200
        assert len(response1.json()) >= 1

        # Пошук по англійській назві
        response2 = await auth_client.get("/api/poses/search", params={"q": "Warrior"})
        assert response2.status_code == 200
        assert len(response2.json()) >= 1

        # Пошук по коду
        response3 = await auth_client.get("/api/poses/search", params={"q": "WAR"})
        assert response3.status_code == 200
        assert len(response3.json()) >= 1


class TestGenerationE2E:
    """E2E тести для генерації (mock mode)"""

    @pytest.mark.asyncio
    async def test_generate_returns_task(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Тест що генерація повертає task_id"""

        # Створюємо фейковий файл
        file_content = b"fake image content"
        files = {"schema_file": ("test.png", io.BytesIO(file_content), "image/png")}

        response = await auth_client_with_mocked_storage.post(
            "/api/generate", files=files
        )
        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert "status" in data
        assert data["status"] in ["pending", "processing"]

    @pytest.mark.asyncio
    async def test_get_generation_status(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Тест отримання статусу генерації"""

        # Створюємо задачу
        file_content = b"fake image content"
        files = {"schema_file": ("test.png", io.BytesIO(file_content), "image/png")}

        create_response = await auth_client_with_mocked_storage.post(
            "/api/generate", files=files
        )
        task_id = create_response.json()["task_id"]

        # Отримуємо статус
        status_response = await auth_client_with_mocked_storage.get(
            f"/api/generate/status/{task_id}"
        )
        assert status_response.status_code == 200
        data = status_response.json()
        assert data["task_id"] == task_id
        assert "status" in data
        assert "progress" in data

    @pytest.mark.asyncio
    async def test_get_status_not_found(self, auth_client: AsyncClient):
        """Тест статусу неіснуючої задачі"""

        response = await auth_client.get("/api/generate/status/non-existent-task-id")
        assert response.status_code == 404


class TestIntegrationE2E:
    """Інтеграційні E2E тести"""

    @pytest.mark.asyncio
    async def test_full_workflow(
        self,
        auth_client: AsyncClient,
        auth_client_with_mocked_storage: AsyncClient,
    ):
        """Тест повного робочого процесу платформи"""

        # 1. Seed м'язів
        seed_response = await auth_client.post("/api/muscles/seed")
        assert seed_response.status_code == 200
        muscles = seed_response.json()

        # 2. Створюємо категорію
        cat_response = await auth_client.post(
            "/api/categories",
            json={"name": "Тестові пози", "description": "Пози для тестування"},
        )
        assert cat_response.status_code == 201
        category = cat_response.json()

        # 3. Перевіряємо що категорія показує 0 поз
        cat_check = await auth_client.get(f"/api/categories/{category['id']}")
        assert cat_check.json()["pose_count"] == 0

        # 4. Створюємо позу з м'язами
        pose_response = await auth_client.post(
            "/api/poses",
            json={
                "code": "INV01",
                "name": "Стійка на голові",
                "name_en": "Headstand",
                "category_id": category["id"],
                "description": "Класична інверсія",
                "effect": "Покращує кровообіг",
                "muscles": [{"muscle_id": muscles[0]["id"], "activation_level": 90}]
                if muscles
                else [],
            },
        )
        assert pose_response.status_code == 201
        pose = pose_response.json()

        # 5. Перевіряємо що категорія тепер показує 1 позу
        cat_check2 = await auth_client.get(f"/api/categories/{category['id']}")
        assert cat_check2.json()["pose_count"] == 1

        # 6. Отримуємо деталі пози з м'язами
        pose_details = await auth_client.get(f"/api/poses/{pose['id']}")
        assert pose_details.status_code == 200
        details = pose_details.json()
        assert details["category_name"] == "Тестові пози"
        if muscles:
            assert len(details["muscles"]) == 1
            assert details["muscles"][0]["activation_level"] == 90

        # 7. Перевіряємо список поз по категорії
        poses_by_cat = await auth_client.get(f"/api/poses/category/{category['id']}")
        assert len(poses_by_cat.json()) == 1

        # 8. Пошук пози (пошук по англійській назві для надійності)
        search = await auth_client.get("/api/poses/search", params={"q": "Headstand"})
        assert len(search.json()) >= 1

        # 9. Генерація (mock)
        file_content = b"fake schema"
        files = {"schema_file": ("schema.png", io.BytesIO(file_content), "image/png")}
        gen_response = await auth_client_with_mocked_storage.post(
            "/api/generate", files=files
        )
        assert gen_response.status_code == 200

        # 10. Cleanup
        await auth_client.delete(f"/api/poses/{pose['id']}")
        await auth_client.delete(f"/api/categories/{category['id']}")

        # Verify cleanup
        assert (await auth_client.get(f"/api/poses/{pose['id']}")).status_code == 404
        assert (
            await auth_client.get(f"/api/categories/{category['id']}")
        ).status_code == 404
