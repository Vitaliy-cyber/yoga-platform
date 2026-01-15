# Production Dockerfile for Backend
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
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
CMD uvicorn main:app --host 0.0.0.0 --port $PORT --workers 2
