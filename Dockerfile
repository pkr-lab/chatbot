FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS backend
WORKDIR /build/backend
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev \
    && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public \
    TZ=Europe/Berlin \
    TMPDIR=/tmp
WORKDIR /app
COPY --from=backend /build/backend/node_modules ./node_modules
COPY --from=backend /build/backend/dist ./dist
COPY --from=backend /build/backend/package.json ./package.json
COPY --from=frontend /build/frontend/dist ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
