FROM local/deepseek-harness-fleet:dev-baseline-db42baa

ARG ELAN_VERSION=4.2.3
ARG ELAN_SHA256=df0b2b3a439961ffcbb3985214365ffe40f49bc871df04dff268c7d8e21ca8b2
ARG LEAN_VERSION=v4.32.1
ARG MATHLIB_VERSION=v4.32.1
ARG MATHLIB_REV=520045ab14e26149ee970e2e617ca04b09bde5d6

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
        iptables \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        time \
        zstd \
    && rm -rf /var/lib/apt/lists/*

ENV ELAN_HOME=/opt/elan \
    ELAN_NO_OVERRIDE_NOTICE=1 \
    ELAN_NO_UPDATE_CHECK=1 \
    MATHLIB_ROOT=/opt/mathlib \
    PATH="/opt/elan/bin:${PATH}"

RUN curl --fail --location --retry 3 \
        --output /tmp/elan.tar.gz \
        "https://github.com/leanprover/elan/releases/download/v${ELAN_VERSION}/elan-x86_64-unknown-linux-gnu.tar.gz" \
    && echo "${ELAN_SHA256}  /tmp/elan.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/elan.tar.gz -C /tmp \
    && /tmp/elan-init -y --no-modify-path --default-toolchain "leanprover/lean4:${LEAN_VERSION}" \
    && rm -f /tmp/elan.tar.gz /tmp/elan-init \
    && lean --version \
    && lake --version

RUN git clone --branch "${MATHLIB_VERSION}" --depth 1 \
        https://github.com/leanprover-community/mathlib4.git "${MATHLIB_ROOT}" \
    && test "$(git -C "${MATHLIB_ROOT}" rev-parse HEAD)" = "${MATHLIB_REV}" \
    && cd "${MATHLIB_ROOT}" \
    && lake exe cache get \
    && rm -rf "${MATHLIB_ROOT}/.git"

RUN mkdir -p /opt/matilda-eval/pnpm-seed \
    && pnpm --dir /opt/matilda-eval/pnpm-seed init \
    && pnpm --dir /opt/matilda-eval/pnpm-seed config set auto-install-peers false --location project \
    && pnpm --dir /opt/matilda-eval/pnpm-seed add --ignore-scripts \
        "dsh-harmony@0.8.8" \
        "the-binding-of-dsh@0.1.7" \
        "/opt/dsh/plugins/dsh-agent-fleet.tgz" \
        "/opt/dsh/plugins/dsh-llm-memorax-0.1.0.tgz" \
        "@ch4acko3/dsh-turn-fold@0.4.4" \
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
    && rm -rf /opt/matilda-eval/pnpm-seed

COPY requirements.txt /opt/matilda-eval/requirements.txt
RUN python3 -m venv /opt/matilda-eval/venv \
    && /opt/matilda-eval/venv/bin/pip install --no-cache-dir --requirement /opt/matilda-eval/requirements.txt

COPY scripts/verify-environment.py /opt/matilda-eval/verify-environment.py
COPY scripts/verify-network-isolation.py /opt/matilda-eval/verify-network-isolation.py
COPY scripts/lean-mathlib.sh /usr/local/bin/lean-mathlib
COPY scripts/python-venv.sh /usr/local/bin/python
COPY scripts/python-venv.sh /usr/local/bin/python3
COPY scripts/network-guard.sh /opt/matilda-eval/network-guard.sh
RUN sed -i 's/\r$//' \
        /opt/matilda-eval/network-guard.sh \
        /usr/local/bin/lean-mathlib \
        /usr/local/bin/python \
        /usr/local/bin/python3 \
    && chmod 0555 \
        /opt/matilda-eval/network-guard.sh \
        /usr/local/bin/lean-mathlib \
        /usr/local/bin/python \
        /usr/local/bin/python3

ENV PATH="/opt/matilda-eval/venv/bin:${PATH}" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_INDEX=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN python /opt/matilda-eval/verify-environment.py

WORKDIR /workspace
