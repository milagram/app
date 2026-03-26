# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./

# Add the architecture flag to ensure the Linux binary is pulled
RUN npm ci --include=optional && npm install @rollup/rollup-linux-x64-gnu

# Stage 2: Production
FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/ /app/backend/

# Copy built frontend from stage 1
COPY --from=frontend-build /app/dist /app/frontend/

# Create posts directory and non-root user
RUN useradd -m -r milagram && \
    mkdir -p /data/posts && \
    chown -R milagram:milagram /data/posts /app

ENV DATA_DIR=/data/posts
ENV FRONTEND_PATH=/app/frontend

EXPOSE 8000

USER milagram

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/server/ping')" || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
