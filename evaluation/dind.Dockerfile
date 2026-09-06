ARG FLEET_BASE_IMAGE=dsh-fleet-evaluation:baseline
ARG DOCKER_DIND_IMAGE=docker:29.7.2-dind-rootless

FROM ${DOCKER_DIND_IMAGE} AS docker-tools
FROM ${FLEET_BASE_IMAGE}

USER root

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        fuse-overlayfs \
        iproute2 \
        iptables \
        kmod \
        slirp4netns \
        uidmap \
    && rm -rf /var/lib/apt/lists/*

COPY --from=docker-tools /usr/local/bin/containerd /usr/local/bin/containerd
COPY --from=docker-tools /usr/local/bin/containerd-shim-runc-v2 /usr/local/bin/containerd-shim-runc-v2
COPY --from=docker-tools /usr/local/bin/ctr /usr/local/bin/ctr
COPY --from=docker-tools /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-tools /usr/local/bin/docker-compose /usr/local/bin/docker-compose
COPY --from=docker-tools /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=docker-tools /usr/local/bin/docker-init /usr/local/bin/docker-init
COPY --from=docker-tools /usr/local/bin/docker-proxy /usr/local/bin/docker-proxy
COPY --from=docker-tools /usr/local/bin/dockerd /usr/local/bin/dockerd
COPY --from=docker-tools /usr/local/bin/dockerd-entrypoint.sh /usr/local/bin/dockerd-entrypoint.sh
COPY --from=docker-tools /usr/local/bin/rootlesskit /usr/local/bin/rootlesskit
COPY --from=docker-tools /usr/local/bin/runc /usr/local/bin/runc
COPY --from=docker-tools /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY evaluation/dind-entrypoint.sh /usr/local/bin/dsh-fleet-dind

RUN chmod 0755 /usr/local/bin/dsh-fleet-dind \
    && mkdir -p /run/user/10001 /home/evaluator/.local/share/docker \
    && chown -R evaluator:evaluator /run/user/10001 /home/evaluator/.local \
    && printf 'evaluator:100000:65536\n' >> /etc/subuid \
    && printf 'evaluator:100000:65536\n' >> /etc/subgid

ARG FLEET_REVISION=unknown
LABEL org.opencontainers.image.title="DSH Fleet evaluation DinD overlay" \
      org.opencontainers.image.description="Optional rootless nested Docker runtime for benchmark-managed sandboxes" \
      org.opencontainers.image.revision="${FLEET_REVISION}" \
      io.deepseek-harness.evaluation.profile="dind-rootless"

USER evaluator
ENV HOME=/home/evaluator \
    XDG_RUNTIME_DIR=/run/user/10001 \
    DOCKER_HOST=unix:///run/user/10001/docker.sock \
    DOCKER_DRIVER=fuse-overlayfs \
    DOCKER_TLS_CERTDIR=

ENTRYPOINT ["dsh-fleet-dind"]
CMD ["Complete the task in the configured task file."]
