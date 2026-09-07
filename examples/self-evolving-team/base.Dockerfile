# Build from repository root using public runtime packages. Provider credentials
# and optional plugins are supplied separately at deployment, never in this image.
ARG NODE_IMAGE=node:22.22.3-bookworm-slim
FROM ${NODE_IMAGE} AS fleet
ARG PNPM_VERSION=11.19.0
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* && npm install -g "pnpm@${PNPM_VERSION}"
WORKDIR /source
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build \
    && mkdir -p /packages && pnpm pack --pack-destination /packages

FROM ${NODE_IMAGE}
ARG PNPM_VERSION=11.19.0
ARG DSH_VERSION=0.1.1-rc.2
ARG HARMONY_VERSION=0.8.10
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "pnpm@${PNPM_VERSION}" "@deepseek-ai/dsh@${DSH_VERSION}" "dsh-harmony@${HARMONY_VERSION}"
COPY --from=fleet /packages/dsh-agent-fleet-*.tgz /opt/dsh/plugins/dsh-agent-fleet.tgz
COPY examples/self-evolving-team/scripts/generic-entrypoint /usr/local/bin/dsh-container-entrypoint
COPY examples/self-evolving-team/scripts/tcp-proxy.mjs /opt/dsh/tcp-proxy.mjs
RUN sed -i 's/\r$//' /usr/local/bin/dsh-container-entrypoint && chmod 0755 /usr/local/bin/dsh-container-entrypoint
ENTRYPOINT ["/usr/local/bin/dsh-container-entrypoint"]
