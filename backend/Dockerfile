# Production Dockerfile for Backend
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# No local storage - using S3

# Railway injects PORT env variable, default to 8000
ENV PORT=8000
EXPOSE 8000

# Run with uvicorn - use shell form to expand $PORT
# Using 1 worker because WebSocket manager is in-memory and not shared across workers
# For multi-worker support, implement Redis pub/sub for WebSocket broadcasts
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
