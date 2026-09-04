#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INTEGRATION_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(cd "$INTEGRATION_DIR/../.." && pwd)

REMOTE_HOST=${ALE_REMOTE_HOST:-cuhksz106_zzr}
ALE_ROOT=${ALE_ROOT:-/data/zzr/frontal-team/ale/repo}
REMOTE_CONFIG_ROOT=${ALE_CONFIG_ROOT:-/data/zzr/frontal-team/ale/run-configs/dsh-fleet-scenarios}
REMOTE_BUILD_ROOT=${ALE_BUILD_ROOT:-/data/zzr/frontal-team/ale/dsh-fleet-build-0.2.0}
REMOTE_OUTPUT_ROOT=${ALE_OUTPUT_ROOT:-/data/zzr/frontal-team/ale/runs-dsh-fleet-scenarios}
IMAGE=${ALE_DSH_FLEET_IMAGE:-ale-ubuntu22-dsh-fleet:0.2.0}

usage() {
  cat <<'EOF'
Usage: scenario.sh <command> [scenario]

Commands:
  list                         List the four reproducible scenarios.
  sync                         Install adapter, configs, and Docker build context remotely.
  build                        Sync and build the Fleet 0.2.0 ALE image.
  prepare                      Build the image and dry-run all scenarios.
  dry-run <name|all>           Validate the selected ALE run matrix.
  run <name|all>               Start a fresh episode; prior results are never reused.
  score <name|all>             Show the latest official evaluator result.
  containers                   List preserved ALE containers and their states.

Scenarios: data-pipeline, cost-optimization, k8s-migration, ranking-recovery
EOF
}

for_each_scenario() {
  local callback=$1
  local requested=${2:-}
  if [[ "$requested" == all ]]; then
    "$callback" data-pipeline
    "$callback" cost-optimization
    "$callback" k8s-migration
    "$callback" ranking-recovery
  else
    validate_scenario "$requested"
    "$callback" "$requested"
  fi
}

validate_scenario() {
  case "${1:-}" in
    data-pipeline|cost-optimization|k8s-migration|ranking-recovery) ;;
    *)
      echo "Unknown scenario: ${1:-<missing>}" >&2
      usage >&2
      exit 2
      ;;
  esac
}

list_scenarios() {
  printf '%-20s %s\n' data-pipeline 'Official ETL/data-warehouse task (the just-run scenario; previous score 0.6667)'
  printf '%-20s %s\n' cost-optimization 'AWS resource cost analysis and optimization report'
  printf '%-20s %s\n' k8s-migration 'Container/Kubernetes migration with executable verification'
  printf '%-20s %s\n' ranking-recovery 'Ranking-node feature-parity incident recovery'
}

load_api_key() {
  if [[ -n "${DEEPSEEK_FLASH_API_KEY:-}" ]]; then
    printf '%s' "$DEEPSEEK_FLASH_API_KEY"
    return
  fi
  node --input-type=module - "$HOME/.dsh/.credentials.yaml" <<'EOF'
import fs from 'node:fs'
import YAML from 'yaml'
const credentials = YAML.parse(fs.readFileSync(process.argv[2], 'utf8'))
const value = credentials?.refs?.DEEPSEEK_FLASH_API_KEY
if (!value) throw new Error('DEEPSEEK_FLASH_API_KEY is absent from DSH credentials')
process.stdout.write(String(value))
EOF
}

sync_remote() {
  ssh "$REMOTE_HOST" "mkdir -p '$ALE_ROOT/ale_run/agents/dsh_fleet' '$REMOTE_CONFIG_ROOT' '$REMOTE_BUILD_ROOT' '$REMOTE_OUTPUT_ROOT'"
  rsync -az --exclude '__pycache__/' "$INTEGRATION_DIR/dsh_fleet/" "$REMOTE_HOST:$ALE_ROOT/ale_run/agents/dsh_fleet/"
  rsync -az "$SCRIPT_DIR/scenarios/" "$REMOTE_HOST:$REMOTE_CONFIG_ROOT/"
  rsync -az \
    "$INTEGRATION_DIR/Dockerfile" \
    "$INTEGRATION_DIR/enable-profile.cjs" \
    "$INTEGRATION_DIR/memorax-headless.patch.yml" \
    "$REPO_ROOT/examples/frontal-team/teams/coding-small.json" \
    "$REMOTE_HOST:$REMOTE_BUILD_ROOT/"
  echo "Synced ALE Fleet scenarios to $REMOTE_HOST"
}

build_image() {
  sync_remote
  ssh "$REMOTE_HOST" "docker build -t '$IMAGE' '$REMOTE_BUILD_ROOT'"
}

run_ale() {
  local scenario=$1
  local mode=$2
  local key
  key=$(load_api_key)
  printf '%s\n' "$key" | ssh "$REMOTE_HOST" \
    "IFS= read -r DEEPSEEK_FLASH_API_KEY; export DEEPSEEK_FLASH_API_KEY; cd '$ALE_ROOT'; .venv/bin/python -m ale_run run '$REMOTE_CONFIG_ROOT/$scenario.yaml' $mode"
}

dry_run_one() {
  echo "== dry-run: $1 =="
  run_ale "$1" '--dry-run --verbose'
}

run_one() {
  echo "== fresh run: $1 =="
  run_ale "$1" '--disable-resume'
}

score_one() {
  local scenario=$1
  local root="$REMOTE_OUTPUT_ROOT/$scenario"
  local legacy_root=''
  if [[ "$scenario" == data-pipeline ]]; then
    legacy_root=/data/zzr/frontal-team/ale/runs-dsh-fleet-data-pipeline-20260830
  fi
  echo "== latest score: $scenario =="
  ssh "$REMOTE_HOST" "cd '$ALE_ROOT'; .venv/bin/python - '$root' '$legacy_root'" <<'PY'
import json
import sys
from pathlib import Path

roots = [Path(value) for value in sys.argv[1:] if value]
results = sorted(
    (path for root in roots for path in root.rglob('eval_result.json')),
    key=lambda path: path.stat().st_mtime,
    reverse=True,
)
if not results:
    print('no completed evaluator result yet')
    raise SystemExit(0)
path = results[0]
data = json.loads(path.read_text())
print(f"score={data.get('score')} eval_status={data.get('eval_status')}")
print(path)
PY
}

list_containers() {
  ssh "$REMOTE_HOST" \
    "docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}' | awk -F '\t' '\$3 == \"ale-ubuntu22-dsh-fleet:0.1.5\" || \$3 == \"$IMAGE\" { print }'"
}

command=${1:-}
scenario=${2:-}
case "$command" in
  list) list_scenarios ;;
  sync) sync_remote ;;
  build) build_image ;;
  prepare)
    build_image
    for_each_scenario dry_run_one all
    ;;
  dry-run) for_each_scenario dry_run_one "$scenario" ;;
  run) for_each_scenario run_one "$scenario" ;;
  score) for_each_scenario score_one "$scenario" ;;
  containers) list_containers ;;
  -h|--help|help|'') usage ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 2
    ;;
esac
