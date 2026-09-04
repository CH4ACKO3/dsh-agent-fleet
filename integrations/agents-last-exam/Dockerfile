ARG ALE_BASE_IMAGE=agentslastexam/ale-ubuntu22-docker:latest
FROM ${ALE_BASE_IMAGE}

ENV PATH="/home/user/.npm-global/bin:${PATH}"

USER root
RUN if ! command -v dsh >/dev/null 2>&1; then \
      npm install --global \
        pnpm@11.19.0 \
        @deepseek-ai/dsh@0.1.1-rc.2 \
        dsh-harmony@0.8.8; \
    fi \
    && dsh --version \
    && pnpm --version
RUN npm install --global dsh-llm-memorax@0.1.0
RUN ln -sf /home/user/.npm-global/bin/dsh-llm-memorax-bridge /usr/local/bin/dsh-llm-memorax-bridge

COPY enable-profile.cjs /opt/dsh-fleet-ale/enable-profile.cjs
COPY coding-small.json /opt/dsh-fleet-ale/coding-small.json
COPY memorax-headless.patch.yml /opt/dsh-fleet-ale/memorax-headless.patch.yml
RUN chown -R user:user /opt/dsh-fleet-ale /home/user/.dsh /home/user/.npm-global

USER user
RUN for profile in headless web; do \
      dsh --profile "$profile" --dump-config > /dev/null \
      && printf '\nallowBuilds:\n  dsh-harmony: true\n' >> "/home/user/.dsh/profiles/$profile/pnpm-workspace.yaml" \
      && dsh plugin --profile "$profile" add dsh-agent-fleet@0.2.0 \
      && node /opt/dsh-fleet-ale/enable-profile.cjs "/home/user/.dsh/profiles/$profile/package.json" \
      && dsh --profile "$profile" --dump-config > "/tmp/dsh-fleet-$profile.yml" \
      && grep -q 'dsh-agent-fleet' "/tmp/dsh-fleet-$profile.yml"; \
    done
