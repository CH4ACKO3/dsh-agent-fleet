#!/bin/sh
set -eu

: "${DSH_HOME:?DSH_HOME is required}"
: "${DSH_FLEET_PACKAGE:?DSH_FLEET_PACKAGE is required}"
: "${DSH_FLEET_PATCH:?DSH_FLEET_PATCH is required}"

profile="${DSH_FLEET_PROFILE:-headless}"
resolved="${DSH_FLEET_VERIFY_OUTPUT:-/tmp/dsh-fleet-profile.yml}"

dsh --profile "$profile" --dump-config >/dev/null
dsh plugin --profile "$profile" add "$DSH_FLEET_PACKAGE" --allow-build=dsh-harmony
dsh --profile "$profile" --patch "$DSH_FLEET_PATCH" --dump-config >"$resolved"
grep -q 'name: dsh-agent-fleet/evaluation' "$resolved"
grep -q 'name: dsh-agent-fleet' "$resolved"
