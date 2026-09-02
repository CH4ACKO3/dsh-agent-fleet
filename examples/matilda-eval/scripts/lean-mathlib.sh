#!/bin/sh
set -eu

cd "${MATHLIB_ROOT:-/opt/mathlib}"
exec /opt/elan/bin/lake env lean "$@"
