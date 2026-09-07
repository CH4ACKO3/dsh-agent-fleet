ARG FLEET_IMAGE=ale-ubuntu22-dsh-fleet:20260908
FROM ${FLEET_IMAGE}
USER root
COPY integrations/horizonmath/server-entrypoint.sh /usr/local/bin/fleet-horizonmath
RUN chmod 0755 /usr/local/bin/fleet-horizonmath \
    && python3 -c 'import mpmath, sympy, numpy, scipy'
USER user
WORKDIR /workspace
ENV FLEET_EVAL_WORKSPACE=/workspace FLEET_EVAL_OUTPUT=/results \
    FLEET_EVAL_PROVIDER=memorax FLEET_EVAL_MODEL=deepseek-v4-flash \
    DSH_TELEMETRY_MODE=DISABLED DSH_PERMISSION_MODE=danger-full-access
ENTRYPOINT ["fleet-horizonmath"]
