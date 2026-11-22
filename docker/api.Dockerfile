# syntax=docker/dockerfile:1.7
# Multi-stage build for the API. Runtime image holds only production deps and compiled JS,
# and runs as the unprivileged "node" user.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@mandapambook/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @mandapambook/shared build \
 && pnpm --filter @mandapambook/api build \
 && pnpm --filter @mandapambook/api deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
# Patch OS packages, and drop npm, npx and corepack: the runtime only runs node, and their
# bundled dependencies (undici, brace-expansion, ...) would otherwise be shipped and scanned.
RUN apk upgrade --no-cache && apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# Commit the image was built from; /health reports it so deploys can confirm the rollout.
# Declared after the package layer so a new commit does not invalidate that cache.
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
