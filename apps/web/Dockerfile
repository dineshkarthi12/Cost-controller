# syntax=docker/dockerfile:1
# Build context: repository root.   docker build -f apps/web/Dockerfile -t toprock-web .
# Behind a TLS-intercepting proxy, pass its CA:   --secret id=ca_cert,src=/path/ca.pem
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi \
    && npm ci --workspace @toprock/web --workspace @toprock/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN cd apps/web && npm run build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
