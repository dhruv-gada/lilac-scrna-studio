# Lilac scRNA Studio – demo deployment (no R or sequencing tools).
# Stage 1 builds the React frontend; stage 2 runs FastAPI and serves the built files.

FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx tsc -b && npx vite build --mode production

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    LILAC_DEMO=1 LILAC_DATA_DIR=/data LILAC_WEB_DIR=/app/frontend/dist
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" pydantic numpy
COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist
RUN mkdir -p /data
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
