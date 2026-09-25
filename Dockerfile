# syntax=docker/dockerfile:1.7
# Imagens de produção: `web` (Next.js standalone) e `worker` (worker + migrações).
# Sinais/zumbis: usar `init: true` no compose (Node trata SIGTERM no worker e no server).
# Base fixada por digest; lockfile congelado; runtime sem código-fonte TS nem devDependencies.
ARG NODE_IMAGE=node:22.22-alpine@sha256:e58326d0d441090181ac150dc2078d3e2cf6a0d42e809aebba3ef5880935ffdd

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# CA extra opcional (ambientes com proxy TLS corporativo): --secret id=ca_bundle,src=ca.crt
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; fi; \
    corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /src

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/app/package.json packages/app/
COPY tests/package.json tests/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle npm_config_cafile=/run/secrets/ca_bundle; fi; \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @gct/web build \
 && pnpm --filter @gct/worker build \
 && pnpm --filter @gct/worker deploy --prod --legacy /out/worker

# ------------------------------------------------------------------ web
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN mkdir -p /data/storage && chown node:node /data/storage
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]

# ------------------------------------------------------------------ worker (também executa migrações como job)
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data/storage && chown node:node /data/storage
COPY --from=build --chown=node:node /out/worker/node_modules ./node_modules
COPY --from=build --chown=node:node /src/apps/worker/dist ./dist
COPY --from=build --chown=node:node /src/packages/db/migrations ./migrations
USER node
CMD ["node", "--enable-source-maps", "dist/worker.js"]
