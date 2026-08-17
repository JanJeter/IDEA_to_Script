FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build -w @idea2screenplay/web

FROM caddy:2.10-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY apps/web/Caddyfile.bootstrap /etc/caddy/Caddyfile.bootstrap
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80 443
