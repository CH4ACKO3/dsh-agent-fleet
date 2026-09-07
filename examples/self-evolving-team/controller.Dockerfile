ARG DOCKER_IMAGE=docker:28.5.1-cli
ARG NODE_IMAGE=node:22.22.3-bookworm-slim
FROM ${DOCKER_IMAGE} AS dockercli
FROM ${NODE_IMAGE}
ARG PNPM_VERSION=11.19.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 python3-venv python3-yaml openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "pnpm@${PNPM_VERSION}"
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY examples/self-evolving-team /opt/controller
WORKDIR /opt/controller
ENTRYPOINT ["node", "/opt/controller/scripts/container-controller.mjs"]
