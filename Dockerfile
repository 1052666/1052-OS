# ── Stage 1: Build frontend ──
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ──
FROM node:20-slim AS backend-build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY backend/ ./
RUN npm run build

# ── Stage 3: Runtime ──
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y nginx && \
    rm -rf /var/lib/apt/lists/*

# Copy built backend (dist + node_modules with native bindings)
WORKDIR /app/backend
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./

# Copy built frontend static files
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# Nginx config
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Startup script
COPY deploy/start.sh /start.sh
RUN chmod +x /start.sh

# Data volume
VOLUME /app/data
ENV DATA_DIR=/app/data
ENV PORT=10053

EXPOSE 80

CMD ["/start.sh"]
