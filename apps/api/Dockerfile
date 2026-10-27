# syntax=docker/dockerfile:1
# Build context: repository root.   docker build -f apps/api/Dockerfile -t toprock-api .
# Behind a TLS-intercepting proxy, pass its CA:   --secret id=ca_cert,src=/path/ca.pem
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi \
    && npm ci --workspace @toprock/api --workspace @toprock/shared --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi \
    && cd apps/api && npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S toprock && adduser -S -G toprock toprock && mkdir -p /data/storage && chown -R toprock:toprock /data
ENV NODE_ENV=production STORAGE_DIR=/data/storage API_PORT=4000
# Dev dependencies (prisma CLI, tsx) are kept so the container can apply migrations and run the optional demo seed.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts /app/apps/api/tsconfig.json ./apps/api/
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/src ./apps/api/src
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/assets ./apps/api/assets
WORKDIR /app/apps/api
USER toprock
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
# Apply pending (forward-only) migrations, then start. Run with an init process (compose: init: true).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
