ARG NODE_IMAGE=node:22.22.3-bookworm-slim

FROM ${NODE_IMAGE} AS builder

ARG DSH_VERSION=0.1.1-rc.2
ARG PNPM_VERSION=11.19.0

RUN npm install --global "pnpm@${PNPM_VERSION}" "@deepseek-ai/dsh@${DSH_VERSION}"

WORKDIR /opt/fleet-source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/message/package.json packages/message/package.json
COPY packages/resources/package.json packages/resources/package.json
COPY packages/dsh-hover-hint/package.json packages/dsh-hover-hint/package.json
COPY packages/dsh-fleet-patchouli/package.json packages/dsh-fleet-patchouli/package.json
COPY packages/git/package.json packages/git/package.json
COPY packages/lark/package.json packages/lark/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @dsh-agent-fleet/core \
         --filter @dsh-agent-fleet/gateway \
         --filter @dsh-agent-fleet/message \
         --filter @dsh-agent-fleet/resources build \
    && pnpm run build:host \
    && mkdir -p /opt/fleet-package \
    && pnpm pack --pack-destination /opt/fleet-package

ENV DSH_HOME=/opt/dsh-profile \
    DSH_FLEET_PACKAGE=/opt/fleet-package/dsh-agent-fleet-0.2.0.tgz \
    DSH_FLEET_PATCH=/opt/fleet-source/evaluation/headless.patch.yml \
    DSH_FLEET_VERIFY_OUTPUT=/tmp/evaluation-profile.yml
RUN chmod 0755 /opt/fleet-source/evaluation/install-headless-profile.sh \
    && /opt/fleet-source/evaluation/install-headless-profile.sh

FROM ${NODE_IMAGE} AS runtime

ARG DSH_VERSION=0.1.1-rc.2
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@deepseek-ai/dsh@${DSH_VERSION}"

COPY --from=builder /opt/dsh-profile /opt/dsh-profile
COPY --from=builder /opt/fleet-package /opt/fleet-package
COPY evaluation/headless.patch.yml /opt/dsh-evaluation/headless.patch.yml
COPY evaluation/run-headless.sh /usr/local/bin/dsh-fleet-evaluation
COPY evaluation/check-runtime.sh /usr/local/bin/dsh-fleet-evaluation-check

RUN chmod 0755 /usr/local/bin/dsh-fleet-evaluation /usr/local/bin/dsh-fleet-evaluation-check \
    && useradd --create-home --uid 10001 evaluator \
    && mkdir -p /workspace /results /run/dsh-home \
    && chown -R evaluator:evaluator /workspace /results /run/dsh-home

ARG FLEET_REVISION=unknown
LABEL org.opencontainers.image.title="DSH Fleet evaluation baseline" \
      org.opencontainers.image.description="Reusable headless DSH and Fleet runtime for isolated benchmark episodes" \
      org.opencontainers.image.revision="${FLEET_REVISION}" \
      io.deepseek-harness.evaluation.baseline="1" \
      io.deepseek-harness.version="${DSH_VERSION}"

USER evaluator
WORKDIR /workspace
ENV DSH_HOME=/run/dsh-home \
    DSH_PERMISSION_MODE=danger-full-access \
    DSH_TELEMETRY_MODE=DISABLED \
    FLEET_EVAL_WORKSPACE=/workspace \
    FLEET_EVAL_OUTPUT=/results

ENTRYPOINT ["dsh-fleet-evaluation"]
CMD ["Complete the task in the configured task file."]
