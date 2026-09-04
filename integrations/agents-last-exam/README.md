# Agent Last Exam integration

This adapter keeps ALE's native task staging, episode lifecycle, output collection, and evaluator. It replaces only
the agent harness with released DSH profiles plus `dsh-agent-fleet` and the repository's `coding-small` Team
template. The image contains both `headless` (benchmark execution) and `web` (post-run browser inspection)
profiles.

Build a thin image on a host that already has the official ALE base image:

```sh
context=$(mktemp -d)
cp integrations/agents-last-exam/Dockerfile "$context/Dockerfile"
cp integrations/agents-last-exam/enable-profile.cjs "$context/enable-profile.cjs"
cp integrations/agents-last-exam/memorax-headless.patch.yml "$context/memorax-headless.patch.yml"
cp examples/frontal-team/teams/coding-small.json "$context/coding-small.json"
docker build -t ale-ubuntu22-dsh-fleet:0.2.0 "$context"
```

Copy `dsh_fleet/` into the ALE checkout at `ale_run/agents/dsh_fleet/`, then use either
`agent-deepseek.yaml` or `agent-memorax.yaml` as the experiment's `agent`. The environment snapshot must point at
`ale-ubuntu22-dsh-fleet:0.2.0` and expose `DEEPSEEK_API_KEY` to the ALE host so the config resolver can pass it to
the isolated episode. The Memorax route instead consumes `DEEPSEEK_FLASH_API_KEY` and starts its packaged local
TLS bridge for the lifetime of the episode.

The deployer launches one native DSH foreground Session solely as the Team launcher. It creates and starts the
persistent Team, remains alive until the Team reaches an explicit terminal vote, and captures DSH Session logs plus
Fleet state alongside the normal ALE trajectory. It does not bypass the task evaluator or read ALE reference output.

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
uses `DEEPSEEK_FLASH_API_KEY` from the environment and otherwise reads the existing local DSH credential reference.
