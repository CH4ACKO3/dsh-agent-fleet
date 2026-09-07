# Agent Last Exam integration

This adapter keeps ALE's native task staging, episode lifecycle, output collection, and evaluator. It replaces only
the agent harness with released DSH profiles plus `dsh-agent-fleet` and the repository's `coding-small` Team
template. The image contains only the `headless` benchmark runtime; WebUI/Harmony belongs in a separate
post-run inspector and cannot affect the episode result.

Build a thin image on a host that already has the official ALE base image:

```sh
context=$(mktemp -d)
cp integrations/agents-last-exam/Dockerfile "$context/Dockerfile"
cp evaluation/headless.patch.yml "$context/headless.patch.yml"
cp evaluation/install-headless-profile.sh "$context/install-headless-profile.sh"
cp examples/frontal-team/teams/coding-small.json "$context/coding-small.json"
pnpm run build
pnpm pack --pack-destination "$context"
docker build -t ale-ubuntu22-dsh-fleet:0.2.0 "$context"
```

Copy `dsh_fleet/` into the ALE checkout at `ale_run/agents/dsh_fleet/`, then use either
`agent-deepseek.yaml` or `agent-memorax.yaml` as the experiment's `agent`. The environment snapshot must point at
`ale-ubuntu22-dsh-fleet:0.2.0` and expose `DEEPSEEK_API_KEY` to the ALE host so the config resolver can pass it to
the isolated episode. The Memorax route instead consumes `DEEPSEEK_FLASH_API_KEY` and starts its packaged local
TLS bridge for the lifetime of the episode.

The deployer invokes the Fleet evaluation runner with a minimal task pointer. The runner creates the Team, lets its
assistant design and start the DAG once, then waits for the Work terminal state in host code. It captures the answer,
status, usage, artifacts, event trace, DSH Sessions, and Fleet state alongside the normal ALE trajectory. It does not
bypass the task evaluator, read ALE reference output, or spend model calls polling for completion.

## Reproducible scenarios on `cuhksz106_zzr`

The scenario helper installs the adapter and configuration into the existing ALE checkout. It never reuses an old
episode when running a scenario, and `cleanup_mode: stop` preserves each task container for later inspection.

```sh
# One-time build and validation of every run matrix.
integrations/agents-last-exam/cuhksz/scenario.sh prepare

# The previously run ETL benchmark, from a fresh official task snapshot.
integrations/agents-last-exam/cuhksz/scenario.sh run data-pipeline

# Other immediately runnable collaboration shapes.
integrations/agents-last-exam/cuhksz/scenario.sh run cost-optimization
integrations/agents-last-exam/cuhksz/scenario.sh run k8s-migration
integrations/agents-last-exam/cuhksz/scenario.sh run ranking-recovery

# Inspect retained containers or the latest official score.
integrations/agents-last-exam/cuhksz/scenario.sh containers
integrations/agents-last-exam/cuhksz/scenario.sh score data-pipeline
```

`run all`, `dry-run all`, and `score all` operate on all four scenarios in the order shown by `list`. A fresh run
uses ALE's `--disable-resume`; prior outputs and the currently open container are left untouched. The helper first
uses the server's `DEEPSEEK_FLASH_API_KEY` environment or the server-only file specified by `ALE_ENV_FILE`.
Its default is `/data/zzr/dsh-agent-fleet-evaluation-20260908/secrets/provider.env`. Local credentials are not transferred.

For bounded parallel execution, attempt records, content-checked resume and explicit train/validation/test assignments,
generate a manifest with `cuhksz/batch-manifest.py` and use the shared `evaluation/batch-run.py` controller. The server
overlay recipe `server-overlay.Dockerfile` reuses an existing provider-enabled ALE image while replacing the full
bundled Fleet package from the common baseline. See `docs/reports/benchmarks-server-20260908.md` for actual deployment
paths, startup fixes and current limitations.
