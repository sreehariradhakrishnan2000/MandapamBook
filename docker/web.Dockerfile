# syntax=docker/dockerfile:1.7
# Build the Angular app, then serve static files from an unprivileged nginx (port 8080).
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 CI=true NG_CLI_ANALYTICS=false
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@mandapambook/web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
# The web app imports @mandapambook/shared, which resolves to its compiled dist/.
RUN pnpm --filter @mandapambook/shared build \
 && pnpm --filter @mandapambook/web build

FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
ENV API_UPSTREAM=http://api:4000
# Origin of the S3-compatible store that browsers upload photos to (added to CSP connect-src),
# e.g. https://br-xxxx.storage.c-16.us-east-1.aws.neon.tech
ENV STORAGE_ORIGIN=""
# The base image lags Alpine security fixes: patch OS packages, then drop back to the
# image's unprivileged nginx user (uid 101).
USER root
RUN apk upgrade --no-cache
USER 101
# The nginx image renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at start.
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.inc.template /etc/nginx/templates/security-headers.inc.template
COPY --from=build /repo/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
