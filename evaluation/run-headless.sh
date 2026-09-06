#!/bin/sh
set -eu

if [ ! -f "$DSH_HOME/profiles/headless/package.json" ]; then
  mkdir -p "$DSH_HOME"
  cp -a /opt/dsh-profile/. "$DSH_HOME/"
fi

exec dsh --profile headless --patch /opt/dsh-evaluation/headless.patch.yml "$@"
