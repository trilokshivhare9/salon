# Deployment, Infrastructure & DevOps Guide

**Document Version:** 1.0.0  
**Target Environments:** Local Development, Staging, Cloud Production  
**Containerization:** Docker & Docker Compose  
**Process Manager:** Node.js Cluster / PM2 / Cloud Container Runtime  

---

## 1. Deployment Architecture

```
                                  [ Internet Users / Salons ]
                                               |
                                               v (HTTPS Port 443)
                        +-----------------------------------------------+
                        |       Cloudflare / Cloud Load Balancer        |
                        |      (SSL Termination, DDoS, CDN Cache)       |
                        +-----------------------------------------------+
                                               |
                     +-------------------------+-------------------------+
                     |                                                   |
                     v                                                   v
+------------------------------------------+    +------------------------------------------+
|      Frontend Web App (Flutter Web)      |    |        Backend API Service (NestJS)      |
|    - Static S3 / Cloudflare Pages / Nginx|    |    - Docker Container Engine             |
|    - Serves /book/:slug & Admin UI       |    |    - Health Probes: GET /health          |
+------------------------------------------+    +------------------------------------------+
                                                                         |
                                         +-------------------------------+-------------------------------+
                                         |                                                               |
                                         v                                                               v
                      +------------------------------------+                          +------------------------------------+
                      |     PostgreSQL 16+ Managed DB      |                          |         Redis 7+ Managed Cache     |
                      |   - Automated Daily Backups        |                          |   - Session & Webhook Deduplication|
                      |   - PgBouncer Connection Pool      |                          |   - Notification Job Queue         |
                      +------------------------------------+                          +------------------------------------+
```

---

## 2. Environment Configuration Matrix

The backend requires the following structured environment variables:

| Variable Name | Description | Example (Local Dev) | Production Strategy |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Runtime environment | `development` | Set to `production` |
| `PORT` | HTTP port | `3000` | Cloud provided port |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/salon_saas?schema=public` | Managed RDS / Cloud SQL URL with SSL |
| `JWT_SECRET` | Secret for access token signing | `dev-jwt-super-secret-key-32-chars-long` | High-entropy secret from KMS / Vault |
| `JWT_EXPIRES_IN` | Access token lifespan | `1d` | `1h` (accompanied by refresh tokens) |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:8080,http://localhost:3000` | Strict production domain whitelist |
| `WHATSAPP_PHONE_NUMBER_ID`| Meta Cloud API Phone Number ID | `100000000000000` | Injected via secure environment vars |
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API Access Token | `EAA...` | Stored encrypted or in secret manager |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification string | `salon-saas-verify-token-xyz` | Custom secret string configured in Meta Portal |

---

## 3. Docker Containerization

### 3.1 Backend Production Multi-Stage `Dockerfile`
```dockerfile
# --- Stage 1: Build Stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY src ./src
RUN npx prisma generate
RUN npm run build
RUN npm prune --production

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

USER nestjs
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

---

## 4. Local Development Orchestration (`docker-compose.yml`)

Located at `/infrastructure/docker-compose.yml`:
* Runs PostgreSQL 16 on port `5432`.
* Runs Adminer / PgAdmin on port `8080` for database GUI inspection.
* Runs Redis 7 on port `6379`.
* Automatically runs initial DB setup scripts.

---

## 5. Health Checks & Observability

### 5.1 Service Health Probes
* `GET /health/liveness` $\rightarrow$ Returns `200 OK` (HTTP server alive).
* `GET /health/readiness` $\rightarrow$ Checks PostgreSQL database connection and returns `200 OK` or `503 Service Unavailable`.

### 5.2 Logging & Error Monitoring
* Production logging utilizes structured JSON format with correlation IDs (`x-request-id`) on every incoming request.
* Unhandled exceptions trigger Sentry alerts with sanitization of client phone numbers and passwords.
