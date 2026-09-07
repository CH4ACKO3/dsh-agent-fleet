FROM python:3.12.11-slim-bookworm
ARG HORIZONMATH_REVISION=3259167b263ecd054315a41e42a726e834a9122f
LABEL io.deepseek-harness.benchmark=horizonmath
LABEL io.deepseek-harness.horizonmath.revision=${HORIZONMATH_REVISION}
RUN apt-get update && apt-get install -y --no-install-recommends git libgomp1 libgl1 libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.8.22
RUN git clone https://github.com/ewang26/HorizonMath.git /opt/horizonmath \
    && cd /opt/horizonmath && git checkout --detach "${HORIZONMATH_REVISION}" \
    && test "$(git rev-parse HEAD)" = "${HORIZONMATH_REVISION}"
WORKDIR /opt/horizonmath
RUN uv sync --frozen --no-dev
COPY integrations/horizonmath/grade.py /opt/fleet-grade.py
ENV PATH="/opt/horizonmath/.venv/bin:${PATH}" PYTHONPATH=/opt/horizonmath/scripts \
    PYTHONDONTWRITEBYTECODE=1 HOME=/tmp
USER 65534:65534
ENTRYPOINT ["python", "/opt/fleet-grade.py"]
