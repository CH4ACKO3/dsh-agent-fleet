FROM local/deepseek-harness-fleet:dev-baseline-db42baa

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        jq \
        iptables \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        time \
    && rm -rf /var/lib/apt/lists/*

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
COPY scripts/network-guard.sh /opt/matilda-eval/network-guard.sh
RUN chmod 0555 /opt/matilda-eval/network-guard.sh

ENV PATH="/opt/matilda-eval/venv/bin:${PATH}" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_INDEX=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN python /opt/matilda-eval/verify-environment.py

WORKDIR /workspace
