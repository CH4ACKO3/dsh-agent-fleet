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

ENV DSH_HOME=/opt/dsh-profile
RUN dsh --profile headless --dump-config >/dev/null \
    && dsh plugin --profile headless add /opt/fleet-package/dsh-agent-fleet-0.2.0.tgz --allow-build=dsh-harmony \
    && dsh --profile headless --patch /opt/fleet-source/evaluation/headless.patch.yml --dump-config > /tmp/evaluation-profile.yml \
    && grep -q 'name: dsh-agent-fleet/evaluation' /tmp/evaluation-profile.yml \
    && grep -q 'name: dsh-agent-fleet' /tmp/evaluation-profile.yml

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

RUN chmod 0755 /usr/local/bin/dsh-fleet-evaluation \
    && useradd --create-home --uid 10001 evaluator \
    && mkdir -p /workspace /results /run/dsh-home \
    && chown -R evaluator:evaluator /workspace /results /run/dsh-home

USER evaluator
WORKDIR /workspace
ENV DSH_HOME=/run/dsh-home \
    DSH_PERMISSION_MODE=danger-full-access \
    DSH_TELEMETRY_MODE=DISABLED \
    FLEET_EVAL_WORKSPACE=/workspace \
    FLEET_EVAL_OUTPUT=/results

ENTRYPOINT ["dsh-fleet-evaluation"]
CMD ["Complete the task in the configured task file."]
