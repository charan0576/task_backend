# Backend API + video renderer (Node.js, Remotion, headless Chromium) in one image.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv chromium fonts-dejavu-core fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    ADVENT_BROWSER_EXECUTABLE=/usr/bin/chromium \
    ADVENT_CHROME_MODE=chrome-for-testing \
    DATA_DIR=/data \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Python dependencies
COPY backend/requirements.txt backend/requirements.txt
RUN python3 -m venv /opt/venv && pip install --no-cache-dir -r backend/requirements.txt

# Renderer dependencies
COPY renderer/package.json renderer/package-lock.json renderer/
RUN cd renderer && npm ci

# Application code
COPY renderer renderer
COPY backend backend

WORKDIR /app/backend
VOLUME ["/data"]
EXPOSE 8000

# One worker only: video jobs and their progress are held in memory.
# PORT is set by hosts such as Render (default there: 10000); locally and on the VPS it falls back to 8000.
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
