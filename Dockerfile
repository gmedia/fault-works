# syntax=docker/dockerfile:1

# FaultWorks is a static single-page app: build it with Node, serve the files with Nginx.
# Everything runs in the visitor's browser, so the image needs no runtime, database or secrets.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Dependencies first, so source changes do not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/experiment/package.json packages/experiment/
COPY packages/metrics/package.json packages/metrics/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @faultworks/web build

# Unprivileged Nginx listens on 8080 and runs as a non-root user.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
