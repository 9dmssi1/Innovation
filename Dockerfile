# syntax=docker/dockerfile:1
# Node 24 is required by the online SQLite backup scripts.
FROM node:24-bookworm-slim AS source
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir /data /backups && chown node:node /data /backups
# Explicit copies keep local databases, secrets and documentation out of the image.
COPY --chown=node:node package.json server.mjs server-config.mjs server-security.mjs static-files.mjs ./
COPY --chown=node:node public/ ./public/
COPY --chown=node:node scripts/ ./scripts/
USER node

# CI uses a separate target; tests are not included in the deployed image.
FROM source AS test
COPY --chown=node:node tests/ ./tests/
CMD ["node", "--test"]

FROM source AS runtime
EXPOSE 4318 4319
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "server.mjs"]
