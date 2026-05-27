# syntax=docker/dockerfile:1.7
# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.5.0 --activate

WORKDIR /app

# Install dependencies first (layer-cached until lockfile changes)
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build
COPY . .
RUN pnpm build

# Prune to production deps only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Non-root user
RUN addgroup -S huckleberry && adduser -S huckleberry -G huckleberry

# Copy compiled output + prod node_modules only
COPY --from=builder --chown=huckleberry:huckleberry /app/dist ./dist
COPY --from=builder --chown=huckleberry:huckleberry /app/node_modules ./node_modules
COPY --from=builder --chown=huckleberry:huckleberry /app/package.json ./package.json

USER huckleberry

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/src/main"]
