# Yoga Pose Platform

Веб-платформа для йога-студії з AI-генерацією зображень поз та анатомічними шарами.

## Можливості

- Завантаження схематичних зображень поз
- AI-генерація реалістичних фото з схем (FLUX.1 + ControlNet)
- Візуалізація анатомічних шарів (м'язи, скелет)
- Каталог поз з описами, ефектами та інструкціями
- Відображення активних м'язів для кожної пози

## Технології

### Backend
- FastAPI (Python 3.11)
- PostgreSQL
- SQLAlchemy (async)
- FLUX.1 Schnell + ControlNet

### Frontend
- React 18
- TypeScript
- TailwindCSS
- Zustand

## Швидкий старт

### Вимоги

- Python 3.11+
- Docker та Docker Compose (для БД)
- (Опціонально) NVIDIA GPU з 8GB+ VRAM для AI генерації

### Запуск через CLI

1. Клонуйте репозиторій:
```bash
git clone <repository-url>
cd yoga-platform
```

2. Запустіть CLI:
```bash
./yoga-platform
```

CLI автоматично:
- Перевірить всі залежності (Python пакети, CUDA, моделі)
- Запропонує встановити відсутні пакети
- Завантажить AI моделі з прогрес-баром
- Запустить сервер

```
════════════════════════════════════════════════════════════════
                    🧘 YOGA POSE PLATFORM
════════════════════════════════════════════════════════════════

▶ Python пакети
──────────────────────────────────────────────────
  ✓ PyTorch (2.1.2)
  ✓ Diffusers (0.25.0)
  ✓ Transformers (4.36.2)
  ✓ FastAPI (0.109.0)
  ✓ HuggingFace Hub (0.20.0)
  ✓ Pillow (10.2.0)

▶ GPU/CUDA
──────────────────────────────────────────────────
  ✓ CUDA/GPU (NVIDIA RTX 5050, 8.0GB)

▶ AI моделі
──────────────────────────────────────────────────
  ✓ FLUX.1 Schnell (готово)
  ✓ ControlNet Canny (готово)

✓ Система готова до роботи!

Оберіть дію:
  1) Перевірити систему
  2) Запустити сервер
  3) Завантажити моделі
  4) Вихід
```

### Запуск через Docker

```bash
# Development
make dev

# Production  
make prod
```

## Структура проекту

```
yoga-platform/
├── yoga-platform      # CLI точка входу
├── backend/           # FastAPI backend
│   ├── cli_app.py    # TUI інтерфейс
│   ├── api/          # API routes
│   ├── models/       # SQLAlchemy models
│   ├── schemas/      # Pydantic schemas
│   ├── services/     # Business logic & AI
│   └── db/           # Database
├── frontend/          # React frontend
│   └── src/
│       ├── pages/    # Page components
│       ├── components/
│       ├── hooks/    # Custom hooks
│       ├── store/    # Zustand store
│       └── services/ # API client
├── ai/models/         # AI моделі (завантажуються автоматично)
├── storage/          # Uploaded & generated files
└── docker-compose.yml
```

## API Endpoints

### Пози
- `GET /api/poses` - Список поз
- `GET /api/poses/{id}` - Деталі пози
- `POST /api/poses` - Створити позу
- `PUT /api/poses/{id}` - Оновити позу
- `DELETE /api/poses/{id}` - Видалити позу
- `GET /api/poses/search?q=...` - Пошук

### Генерація
- `POST /api/generate/photo` - Згенерувати фото
- `POST /api/generate/muscles` - Згенерувати шар м'язів
- `POST /api/generate/skeleton` - Згенерувати скелет
- `GET /api/generate/status/{task_id}` - Статус генерації

### Категорії та м'язи
- `GET /api/categories` - Список категорій
- `GET /api/muscles` - Список м'язів
- `POST /api/muscles/seed` - Заповнити базу м'язами

## AI Моделі

Моделі завантажуються автоматично через CLI при першому запуску:

- **FLUX.1 Schnell** (~23GB) - базова модель генерації
- **ControlNet Canny** (~3GB) - контроль пози через контури

Вимоги для AI генерації:
- ~26GB дискового простору
- NVIDIA GPU з 8GB+ VRAM
- CUDA 11.8+

Без GPU платформа працює, але AI генерація буде недоступна.

## Конфігурація

### Змінні оточення (.env)

```bash
# Режим роботи
APP_MODE=dev  # dev | prod

# База даних
DATABASE_URL=postgresql://user:pass@localhost:5432/yoga_db

# AI
ENABLE_AI_GENERATION=true  # false для роботи без GPU

# Безпека
SECRET_KEY=your-secret-key
```

## Команди

```bash
./yoga-platform       # Запуск CLI з перевіркою системи

make dev              # Запуск dev середовища (Docker)
make prod             # Запуск production (Docker)
make stop             # Зупинити контейнери
make logs             # Переглянути логи
make clean            # Очистити все
make db-seed          # Заповнити БД початковими даними
make test             # Запустити тести
```

## Ліцензія

MIT
