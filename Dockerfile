# Studio Bars as ONE container: the built web app plus the server. Used by the cloud-host button in the README.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_URL=""
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist frontend/dist
ENV STUDIO_BARS_SERVE_FRONTEND=/app/frontend/dist \
    STUDIO_BARS_DB=/data/studio-bars.db \
    STUDIO_BARS_MEDIA_DIR=/data/media \
    STUDIO_BARS_AI_KEY_DIR=/data/private
WORKDIR /app/backend
# Refuse to start without a PIN: this container is reachable from the internet.
CMD ["sh", "-c", "if [ \"${#STUDIO_BARS_ACCESS_PIN}\" -lt 6 ]; then echo 'Set STUDIO_BARS_ACCESS_PIN to at least 6 characters.' >&2; exit 1; fi; mkdir -p /data && exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
