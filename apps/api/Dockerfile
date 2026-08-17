FROM node:24-bookworm-slim AS base
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build -w @idea2screenplay/api

FROM base AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev --workspace=@idea2screenplay/api --include-workspace-root=false \
  && node node_modules/prisma/build/index.js generate --schema=apps/api/prisma/schema.prisma

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  HOME=/tmp \
  XDG_CACHE_HOME=/tmp/.cache
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema=apps/api/prisma/schema.prisma && exec node apps/api/dist/main.js"]
