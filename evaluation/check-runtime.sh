#!/bin/sh
set -eu

command -v node >/dev/null
command -v dsh >/dev/null
command -v git >/dev/null
command -v python3 >/dev/null

check_home="${DSH_EVAL_PROFILE_HOME:-$(mktemp -d)}"
if [ ! -f "$check_home/profiles/headless/package.json" ]; then
  cp -a /opt/dsh-profile/. "$check_home/"
fi
DSH_HOME="$check_home" dsh --profile headless \
  --patch /opt/dsh-evaluation/headless.patch.yml --dump-config > /tmp/dsh-evaluation-check.yml
grep -q 'name: dsh-agent-fleet/evaluation' /tmp/dsh-evaluation-check.yml
grep -q 'name: dsh-agent-fleet' /tmp/dsh-evaluation-check.yml

printf 'DSH Fleet evaluation baseline is ready.\n'
