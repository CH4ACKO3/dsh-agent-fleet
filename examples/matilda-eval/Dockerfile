FROM local/deepseek-harness-fleet:dev-baseline-db42baa

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        jq \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        time \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /opt/matilda-eval/requirements.txt
RUN python3 -m venv /opt/matilda-eval/venv \
    && /opt/matilda-eval/venv/bin/pip install --no-cache-dir --requirement /opt/matilda-eval/requirements.txt

COPY scripts/verify-environment.py /opt/matilda-eval/verify-environment.py

ENV PATH="/opt/matilda-eval/venv/bin:${PATH}" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_INDEX=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN python /opt/matilda-eval/verify-environment.py

WORKDIR /workspace
