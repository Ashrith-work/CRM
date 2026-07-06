# Multi-stage build for the NestJS API within the pnpm monorepo.
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Prisma needs OpenSSL at build + runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- deps: install with the full workspace manifest set ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# ---- build: compile types + api ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @crm/types build
RUN pnpm --filter @crm/api db:generate
RUN pnpm --filter @crm/api build
# Prune dev dependencies for a lean runtime.
RUN pnpm --filter @crm/api --prod deploy /app/deploy

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/deploy/node_modules ./node_modules
# Overlay the generated Prisma client (not produced by `pnpm deploy`).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/package.json ./package.json
EXPOSE 4000
# Apply migrations then start. Railway injects DATABASE_URL / REDIS_URL / CLERK_SECRET_KEY.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
