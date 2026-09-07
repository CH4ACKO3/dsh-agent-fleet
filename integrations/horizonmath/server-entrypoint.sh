#!/bin/sh
set -eu
: "${DEEPSEEK_FLASH_API_KEY:?Use the existing server provider credential}"
dsh-llm-memorax-bridge > /tmp/fleet-provider.log 2>&1 &
bridge_pid=$!
trap 'kill "$bridge_pid" 2>/dev/null || true' EXIT INT TERM
dsh --profile headless --patch /opt/dsh-fleet-ale/headless.patch.yml \
    "Complete the task in the configured task file."
