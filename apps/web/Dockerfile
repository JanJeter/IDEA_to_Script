FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build -w @idea2screenplay/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY apps/web/nginx.bootstrap.conf /etc/nginx/nginx.bootstrap.conf
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80 443
