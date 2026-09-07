ARG FLEET_IMAGE=dsh-fleet-evaluation:baseline
FROM ${FLEET_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/math-venv \
    && /opt/math-venv/bin/pip install --no-cache-dir mpmath==1.3.0 sympy==1.14.0 numpy==2.2.6 scipy==1.15.3
ENV PATH="/opt/math-venv/bin:${PATH}"
USER evaluator
