#!/bin/sh
set -eu

cd "${MATHLIB_ROOT:-/opt/mathlib}"
exec lake env lean "$@"
