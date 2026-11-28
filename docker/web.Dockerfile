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
    pnpm install --frozen-lockfile --filter "@mandapambook/web..." --filter "@mandapambook/shared"
COPY packages/shared packages/shared
COPY apps/web apps/web
# The web app imports @mandapambook/shared, which resolves to its compiled dist/.
RUN pnpm --filter @mandapambook/shared build \
 && pnpm --filter @mandapambook/web build

# Alpine's own nginx package, not the nginx.org-built nginx-unprivileged image: Alpine ships
# nginx security fixes sooner (1.30.7 was in Alpine while that image was still on 1.30.6).
# The pieces that image provided are ours instead: nginx.conf (non-root paths, port 8080),
# web-entrypoint.sh (template rendering) and the unprivileged user.
FROM alpine:3.24 AS runtime
RUN apk upgrade --no-cache \
 && apk add --no-cache nginx gettext-envsubst ca-certificates \
 && rm -f /etc/nginx/http.d/default.conf \
 && mkdir -p /etc/nginx/templates /etc/nginx/conf.d /usr/share/nginx/html \
 && chown nginx:nginx /etc/nginx/conf.d
ENV API_UPSTREAM=http://api:4000
# Origin of the S3-compatible store that browsers upload photos to (added to CSP connect-src),
# e.g. https://br-xxxx.storage.c-16.us-east-1.aws.neon.tech
ENV STORAGE_ORIGIN=""
# Shared with the API (PROXY_SHARED_SECRET): proves X-MB-Client-IP came from this proxy.
# Empty means not sent as trusted; the API then falls back to the edge's client-IP header.
ENV PROXY_SHARED_SECRET=""
# "noindex, nofollow" keeps the whole site out of search engines (e.g. while only test
# venues are listed). Empty sends no header.
ENV ROBOTS_TAG=""
# The site's real domain (e.g. mandapambooking.in). Visits to the platform's *.onrender.com
# address are redirected there, except payment webhooks and /healthz. Empty = no redirect.
ENV CANONICAL_HOST=""
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0755 docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
# web-entrypoint.sh renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at start.
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.inc.template /etc/nginx/templates/security-headers.inc.template
COPY --from=build /repo/apps/web/dist/web/browser /usr/share/nginx/html
USER nginx
EXPOSE 8080
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/web-entrypoint.sh"]
