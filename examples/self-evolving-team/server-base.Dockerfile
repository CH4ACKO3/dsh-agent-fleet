# Server-only optional derivative. It copies the provider already installed on
# cuhksz106_zzr; no package or secret is uploaded from the user's workstation.
ARG PROVIDER_IMAGE=ale-ubuntu22-dsh-fleet:0.2.0
ARG PUBLIC_BASE=dsh-fleet-evolution-base:20260908
FROM ${PROVIDER_IMAGE} AS provider
FROM ${PUBLIC_BASE}
COPY --from=provider /home/user/.npm-global/lib/node_modules/dsh-llm-memorax /opt/dsh/server-provider
ENV FLEET_PROVIDER_BRIDGE=/opt/dsh/server-provider/bin/local-tls-bridge.mjs \
    MEMORAX_BRIDGE_PORT=3082
