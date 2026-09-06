ARG ALE_BASE_IMAGE=agentslastexam/ale-ubuntu22-docker:latest
FROM ${ALE_BASE_IMAGE}

ENV PATH="/home/user/.npm-global/bin:${PATH}"

USER root
RUN if ! command -v dsh >/dev/null 2>&1; then \
      npm install --global \
        pnpm@11.19.0 \
        @deepseek-ai/dsh@0.1.1-rc.2; \
    fi \
    && dsh --version \
    && pnpm --version
RUN npm install --global dsh-llm-memorax@0.1.0
RUN ln -sf /home/user/.npm-global/bin/dsh-llm-memorax-bridge /usr/local/bin/dsh-llm-memorax-bridge

COPY coding-small.json /opt/dsh-fleet-ale/coding-small.json
COPY headless.patch.yml /opt/dsh-fleet-ale/headless.patch.yml
COPY dsh-agent-fleet-0.2.0.tgz /opt/dsh-fleet-ale/dsh-agent-fleet-0.2.0.tgz
RUN chown -R user:user /opt/dsh-fleet-ale /home/user/.dsh /home/user/.npm-global

USER user
RUN dsh --profile headless --dump-config > /dev/null \
    && dsh plugin --profile headless add /opt/dsh-fleet-ale/dsh-agent-fleet-0.2.0.tgz --allow-build=dsh-harmony \
    && dsh plugin --profile headless add dsh-llm-memorax@0.1.0 \
    && dsh --profile headless --patch /opt/dsh-fleet-ale/headless.patch.yml --dump-config > /tmp/dsh-fleet-headless.yml \
    && grep -q 'name: dsh-agent-fleet/evaluation' /tmp/dsh-fleet-headless.yml \
    && grep -q 'name: dsh-llm-memorax' /tmp/dsh-fleet-headless.yml
