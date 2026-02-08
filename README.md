# Yoga Pose Platform

Веб-платформа для йога-студії з AI-генерацією зображень поз та анатомічними шарами.

## Можливості

- Завантаження схематичних зображень поз
- AI-генерація реалістичних фото з схем (Google Gemini / Nano Banana)
- Візуалізація анатомічних шарів (м'язи)
- Каталог поз з описами, ефектами та інструкціями
- Відображення активних м'язів для кожної пози

## Технології

### Backend
- FastAPI (Python 3.11)
- PostgreSQL
- SQLAlchemy (async)
- Google Gemini API

### Frontend
- React 18
- TypeScript
- TailwindCSS
- Zustand

## Швидкий старт

### Вимоги

- Python 3.11+
- Docker та Docker Compose (для БД)
- (Опціонально) Google Gemini API key для AI генерації

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
- Створить віртуальне середовище та поставить залежності
- Згенерує `.env` шаблон (без hardcoded секретів)
- Запустить backend + frontend

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
├── storage/          # Uploaded & generated files
└── docker-compose.yml
```

## API Endpoints

### Пози
- `GET /api/v1/poses` - Список поз
- `GET /api/v1/poses/{id}` - Деталі пози
- `POST /api/v1/poses` - Створити позу
- `PUT /api/v1/poses/{id}` - Оновити позу
- `DELETE /api/v1/poses/{id}` - Видалити позу
- `GET /api/v1/poses/search?q=...` - Пошук

### Генерація
- `POST /api/v1/generate` - Генерація з завантаженого schema image
- `POST /api/v1/generate/from-text` - Генерація з текстового опису
- `POST /api/v1/generate/from-pose/{pose_id}` - Генерація з існуючої пози
- `GET /api/v1/generate/status/{task_id}` - Статус генерації
- `POST /api/v1/generate/save-to-gallery` - Зберегти результат у галерею

### Категорії та м'язи
- `GET /api/v1/categories` - Список категорій
- `GET /api/v1/muscles` - Список м'язів
- `POST /api/v1/muscles/seed` - Заповнити базу м'язами

## AI Провайдер

Поточна реалізація використовує лише **Google Gemini (Nano Banana)** (`backend/services/google_generator.py`).
Для роботи AI-генерації потрібно встановити `GOOGLE_API_KEY` у `.env`.

## Конфігурація

### Змінні оточення (.env)

```bash
# Режим роботи
APP_MODE=dev  # dev | prod

# База даних
DATABASE_URL=postgresql://user:pass@localhost:5432/yoga_db

# AI
GOOGLE_API_KEY=your-gemini-api-key

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
make test-full        # Повний E2E прогін: backend + e2e core + e2e atomic + e2e legacy
make test-full-strict # test-full + frontend unit тести
```

## Ліцензія

MIT
