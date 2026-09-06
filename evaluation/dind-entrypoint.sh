#!/bin/sh
set -eu

daemon_log="${FLEET_DIND_LOG:-/tmp/dsh-fleet-dockerd.log}"
daemon_pid=

stop_daemon() {
  if [ -n "$daemon_pid" ] && kill -0 "$daemon_pid" 2>/dev/null; then
    kill "$daemon_pid" 2>/dev/null || true
    wait "$daemon_pid" 2>/dev/null || true
  fi
}

trap 'stop_daemon; exit 143' TERM
trap 'stop_daemon; exit 130' INT
trap stop_daemon EXIT

dockerd-entrypoint.sh dockerd \
  --host="$DOCKER_HOST" \
  --storage-driver="$DOCKER_DRIVER" \
  >"$daemon_log" 2>&1 &
daemon_pid=$!

attempt=0
max_attempts="${FLEET_DIND_READY_ATTEMPTS:-60}"
until docker info >/dev/null 2>&1; do
  if ! kill -0 "$daemon_pid" 2>/dev/null; then
    printf 'Nested Docker daemon exited during startup.\n' >&2
    cat "$daemon_log" >&2
    exit 6
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$max_attempts" ]; then
    printf 'Nested Docker daemon did not become ready after %s attempts.\n' "$max_attempts" >&2
    cat "$daemon_log" >&2
    exit 6
  fi
  sleep 1
done

if [ "${1:-}" = '--dind-check' ]; then
  docker info --format '{{json .SecurityOptions}}' | grep -q 'rootless'
  docker run --rm hello-world >/dev/null
  printf 'DSH Fleet rootless DinD overlay is ready.\n'
  exit 0
fi

set +e
dsh-fleet-evaluation "$@"
status=$?
set -e
exit "$status"
