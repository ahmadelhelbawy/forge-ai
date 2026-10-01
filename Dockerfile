# syntax=docker/dockerfile:1
#
# FORGE — the local workspace and the CLI in one image.
#
#   docker compose up --build        # http://localhost:3000
#
# Two stages: `build` installs everything and builds the core and the web app;
# the runtime stage gets only the standalone server and the core's production
# deployment. No credential is ever part of the build: `.dockerignore`
# excludes every `.env*` and data directory, and keys arrive at run time.

ARG NODE_IMAGE=node:22-bookworm-slim

# ── build ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
ENV CI=1 NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src

# Dependencies first, so source edits do not reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY . .
# Builds the core (dist/), then the standalone Next server.
RUN pnpm --dir web build
# The core as a self-contained production package: package.json, dist/,
# profiles/, schema/, strategies/ and its runtime dependencies (including the
# ripgrep binary for this platform). The web server resolves `forge` here.
RUN pnpm --filter forge deploy --prod --legacy /out/forge \
 && test -f /out/forge/dist/index.js \
 && test -d /out/forge/profiles && test -d /out/forge/strategies && test -d /out/forge/schema

# ── runtime ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
# git: the repository-history retriever (repository linkage); tini: signals.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    FORGE_DATA_DIR=/data

WORKDIR /app
COPY --from=build /out/forge /opt/forge
COPY --from=build /src/web/.next/standalone /app
# The standalone trace leaves the `forge` workspace link out (it would recurse);
# point it at the deployed core. `forge` on PATH is the CLI.
RUN ln -s /opt/forge /app/web/node_modules/forge \
 && printf '#!/bin/sh\nexec node /opt/forge/dist/cli/index.js "$@"\n' > /usr/local/bin/forge \
 && chmod 0755 /usr/local/bin/forge \
 && mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 3000

# Inside the container FORGE must listen on all interfaces; keeping it off the
# network is the job of the host port mapping (compose binds 127.0.0.1).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "web/server.js"]
