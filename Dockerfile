FROM node:20-bookworm-slim AS build

RUN sed -i \
    -e 's|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
    -e 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' \
    /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/nbcp/package.json packages/nbcp/package.json

RUN npm config set registry https://registry.npmmirror.com
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim

RUN sed -i \
    -e 's|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
    -e 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' \
    /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /backups /secrets \
  && chown -R node:node /data /backups /secrets

WORKDIR /app
COPY --from=build --chown=node:node /app /app

ENV LOTTERYMCP_DATA_MODE=official
ENV LOTTERYMCP_DATA_DIR=/data
ENV NEUXSBOT_DEFAULT_PERIODS=200

USER node

CMD ["node", "packages/cli/dist/index.js", "ops", "serve-reports", "--host", "0.0.0.0", "--port", "4317"]
