ARG FLEET_IMAGE=dsh-fleet-evaluation:baseline-20260908
ARG ALE_IMAGE=ale-ubuntu22-dsh-fleet:0.2.0
FROM ${FLEET_IMAGE} AS fleet
FROM ${ALE_IMAGE}
USER root
COPY --from=fleet /opt/fleet-package /opt/fleet-package
COPY evaluation/install-headless-profile.sh /opt/dsh-fleet-ale/install-headless-profile.sh
COPY evaluation/headless.patch.yml /opt/dsh-fleet-ale/headless.patch.yml
COPY evaluation/run-headless.sh /usr/local/bin/dsh-fleet-evaluation
COPY examples/frontal-team/teams/coding-small.json /opt/dsh-fleet-ale/coding-small.json
RUN cat /opt/dsh-fleet-ale/memorax-headless.patch.yml >> /opt/dsh-fleet-ale/headless.patch.yml \
    && chown -R user:user /opt/fleet-package /opt/dsh-fleet-ale /home/user/.dsh/profiles/headless \
    && ln -sf /home/user/.npm-global/bin/dsh /usr/local/bin/dsh \
    && chmod 0755 /usr/local/bin/dsh-fleet-evaluation /opt/dsh-fleet-ale/install-headless-profile.sh
ENV DSH_HOME=/home/user/.dsh \
    DSH_FLEET_PACKAGE=/opt/fleet-package/dsh-agent-fleet-0.2.0.tgz \
    DSH_FLEET_PATCH=/opt/dsh-fleet-ale/headless.patch.yml
RUN rm -rf /home/user/.dsh/profiles/headless/node_modules/dsh-agent-fleet \
    && mkdir -p /home/user/.dsh/profiles/headless/node_modules/dsh-agent-fleet \
    && tar -xzf /opt/fleet-package/dsh-agent-fleet-0.2.0.tgz --strip-components=1 \
       -C /home/user/.dsh/profiles/headless/node_modules/dsh-agent-fleet \
    && grep -q taskUnreadSummary /home/user/.dsh/profiles/headless/node_modules/dsh-agent-fleet/node_modules/@dsh-agent-fleet/message/lib/hub.js \
    && chown -R user:user /home/user/.dsh/profiles/headless
USER user
ARG FLEET_REVISION=unknown
LABEL org.opencontainers.image.revision=${FLEET_REVISION}
