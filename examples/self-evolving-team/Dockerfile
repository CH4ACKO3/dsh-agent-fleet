ARG BASE_IMAGE=local/deepseek-harness-fleet:dev-baseline-db42baa
FROM ${BASE_IMAGE}

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git iptables jq procps \
    && rm -rf /var/lib/apt/lists/*

ARG DSH_HARMONY_VERSION=0.8.10
ARG DSH_TURN_FOLD_VERSION=0.6.0
ARG DSH_PATCHOULI_VERSION=0.1.6

# Runtime networking is closed, so every dependency used by the inherited
# entrypoint must be present in the image's pnpm store before a generation starts.
RUN mkdir -p /opt/self-evolve/pnpm-seed \
    && pnpm --dir /opt/self-evolve/pnpm-seed init \
    && pnpm --dir /opt/self-evolve/pnpm-seed config set auto-install-peers false --location project \
    && pnpm --dir /opt/self-evolve/pnpm-seed add --ignore-scripts \
        "dsh-harmony@${DSH_HARMONY_VERSION}" \
        "the-binding-of-dsh@0.1.7" \
        "/opt/dsh/plugins/dsh-agent-fleet.tgz" \
        "/opt/dsh/plugins/dsh-llm-memorax-0.1.0.tgz" \
        "@ch4acko3/dsh-turn-fold@${DSH_TURN_FOLD_VERSION}" \
        "@ch4acko3/dsh-shiki@0.1.2" \
        "@ch4acko3/dsh-syntax-highlight@0.1.1" \
        "@ch4acko3/dsh-code-render@0.1.2" \
        "@ch4acko3/dsh-markdown-render@0.1.2" \
        "@ch4acko3/dsh-mermaid-render@0.1.1" \
        "@ch4acko3/dsh-math-render@0.1.1" \
        "@ch4acko3/dsh-structured-render@0.1.2" \
        "@ch4acko3/dsh-table-render@0.1.2" \
        "@ch4acko3/dsh-code-frame-render@0.1.2" \
        "@ch4acko3/dsh-diff-engine@0.1.2" \
        "@ch4acko3/dsh-diff-render@0.1.3" \
        "@ch4acko3/dsh-ansi-render@0.1.2" \
        "patchouli-db@${DSH_PATCHOULI_VERSION}" \
        "dsh-patchouli@${DSH_PATCHOULI_VERSION}" \
        "dsh-patchouli-native-context-service@${DSH_PATCHOULI_VERSION}" \
        "dsh-agent-fleet-patchouli@0.1.3" \
    && pnpm --dir /opt/self-evolve/pnpm-seed exec patchouli-db --help >/dev/null \
    && rm -rf /opt/self-evolve/pnpm-seed

RUN sed -i \
        -e "s|dsh-harmony@0.8.8|dsh-harmony@${DSH_HARMONY_VERSION}|g" \
        -e "s|@ch4acko3/dsh-turn-fold@0.4.4|@ch4acko3/dsh-turn-fold@${DSH_TURN_FOLD_VERSION}|g" \
        -e "s|@ch4acko3/dsh-turn-fold@0.5.1|@ch4acko3/dsh-turn-fold@${DSH_TURN_FOLD_VERSION}|g" \
        -e "s|memorax-render-v1|memorax-render-v1-turn-fold-${DSH_TURN_FOLD_VERSION}|g" \
        /usr/local/bin/dsh-container-entrypoint \
    && grep -F "dsh-harmony@${DSH_HARMONY_VERSION}" /usr/local/bin/dsh-container-entrypoint \
    && grep -F "@ch4acko3/dsh-turn-fold@${DSH_TURN_FOLD_VERSION}" /usr/local/bin/dsh-container-entrypoint

ENV DSH_HARMONY_ACTIVE_DSH_ENTRY=/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/index.js

COPY team.local.json /opt/self-evolve/team.local.json
COPY scripts /opt/self-evolve/scripts
COPY scripts/network-guard.sh /opt/self-evolve/network-guard.sh
COPY scripts/configure-profile.mjs /opt/dsh/configure-profile.mjs
COPY scripts/dsh-container-entrypoint /usr/local/bin/dsh-container-entrypoint
RUN sed -i 's/\r$//' /opt/self-evolve/network-guard.sh /opt/self-evolve/scripts/*.mjs \
        /usr/local/bin/dsh-container-entrypoint \
    && chmod 0555 /opt/self-evolve/network-guard.sh /opt/self-evolve/scripts/*.mjs \
        /opt/dsh/configure-profile.mjs /usr/local/bin/dsh-container-entrypoint \
    && git config --system --add safe.directory /workspace

WORKDIR /workspace
