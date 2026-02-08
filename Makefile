.PHONY: help dev prod stop logs clean install test test-backend test-frontend-unit test-frontend-e2e-core test-frontend-e2e-atomic test-frontend-e2e-legacy test-full test-full-strict

# Default target
help:
	@echo "Yoga Pose Platform - Available commands:"
	@echo ""
	@echo "  make dev         - Start development environment"
	@echo "  make prod        - Start production environment"
	@echo "  make stop        - Stop all containers"
	@echo "  make logs        - Show logs"
	@echo "  make clean       - Remove containers and volumes"
	@echo "  make install     - Install dependencies locally"
	@echo "  make test        - Run tests"
	@echo "  make test-full   - Run full backend + E2E flow suites (core + atomic + legacy)"
	@echo "  make test-full-strict - test-full + frontend unit tests"
	@echo "  make db-seed     - Seed database with initial data"
	@echo "  make download-models - Download AI models"
	@echo ""

# Development
dev:
	docker-compose -f docker-compose.dev.yml up --build

dev-d:
	docker-compose -f docker-compose.dev.yml up --build -d

# Production
prod:
	docker-compose up --build -d

# Stop
stop:
	docker-compose -f docker-compose.dev.yml down
	docker-compose down

# Logs
logs:
	docker-compose -f docker-compose.dev.yml logs -f

logs-backend:
	docker-compose -f docker-compose.dev.yml logs -f backend

logs-frontend:
	docker-compose -f docker-compose.dev.yml logs -f frontend

# Clean
clean:
	docker-compose -f docker-compose.dev.yml down -v
	docker-compose down -v
	rm -rf storage/uploads/* storage/generated/* storage/layers/*
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Install dependencies locally
install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

# Run backend locally
run-backend:
	cd backend && uvicorn main:app --reload --port 8000 --log-level warning

# Run frontend locally
run-frontend:
	cd frontend && npm run dev

# Tests
test:
	$(MAKE) test-backend

test-cov:
	cd backend && pytest --cov=. --cov-report=html

test-backend:
	UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest backend/tests

test-frontend-unit:
	cd frontend && npm run test:run

test-frontend-e2e-core:
	cd frontend && npm run test:e2e

test-frontend-e2e-atomic:
	cd frontend && npm run test:e2e:atomic

test-frontend-e2e-legacy:
	cd frontend && npm run test:e2e:legacy

test-full:
	$(MAKE) test-backend
	$(MAKE) test-frontend-e2e-core
	$(MAKE) test-frontend-e2e-atomic
	$(MAKE) test-frontend-e2e-legacy

test-full-strict:
	$(MAKE) test-full
	$(MAKE) test-frontend-unit

# Database
db-seed:
	@echo "Seeding database..."
	curl -X POST http://localhost:8000/api/muscles/seed
	@echo "\nDatabase seeded!"

db-migrate:
	cd backend && alembic upgrade head

# AI Models
download-models:
	cd ai/scripts && python download_models.py

test-ai:
	cd ai/scripts && python test_generation.py --help

# Lint
lint:
	cd backend && ruff check .
	cd frontend && npm run lint

# Format
format:
	cd backend && ruff format .
	cd frontend && npm run format
