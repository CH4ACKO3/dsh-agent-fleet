ARG BASE_IMAGE=dsh-fleet-evolution-base:20260908
FROM ${BASE_IMAGE}
USER root
COPY team.local.json /opt/self-evolve/team.local.json
COPY scripts /opt/self-evolve/scripts
COPY scripts/generic-entrypoint /usr/local/bin/dsh-container-entrypoint
RUN sed -i 's/\r$//' /opt/self-evolve/scripts/*.mjs /usr/local/bin/dsh-container-entrypoint \
    && chmod 0555 /opt/self-evolve/scripts/*.mjs /usr/local/bin/dsh-container-entrypoint \
    && git config --system --add safe.directory /workspace
WORKDIR /workspace
