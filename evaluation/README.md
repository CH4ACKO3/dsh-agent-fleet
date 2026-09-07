# Fleet evaluation baseline

## Batch and curriculum execution

`batch-run.py` runs real ALE or HorizonMath tasks with bounded concurrency, resource limits, separate attempt
directories, infrastructure-only retries and content-checked resume. Use Python 3.10+; native ALE additionally
requires PyYAML, normally provided by the official ALE virtual environment.

```sh
python3 evaluation/batch-run.py --help
python3 integrations/agents-last-exam/cuhksz/batch-manifest.py --output /srv/benchmarks/ale-manifest.json
python3 evaluation/batch-run.py --manifest /srv/benchmarks/ale-manifest.json \
  --output /srv/benchmarks/runs/ale-001 --parallel 2 --cpus 4 --memory 8g --timeout-ms 3600000
# Add --resume to the exact same invocation after interruption.
```

ALE's manifest records its official checkout revision and four existing computing-math scenarios, with explicit
train/validation/test assignments. It preserves native staging and scoring. On `cuhksz106_zzr`, use
`/data/zzr/frontal-team/ale/repo/.venv/bin/python` and export the existing server credential before execution.
The new server deployment root is `/data/zzr/dsh-agent-fleet-evaluation-20260908`.

For HorizonMath setup, real data provenance and scoring limitations, see
[its integration README](../integrations/horizonmath/README.md). `--job JOB.json` implements the host curriculum
protocol; generation jobs require a frozen-source image with a matching `org.opencontainers.image.revision`.
An abandoned `.running` lock requires operator inspection. Full machine-crash recovery is not automatic.

Run regression checks with `python3 -m unittest discover -s evaluation -p 'test_*.py'` and
`python3 -m unittest discover -s integrations/horizonmath -p 'test_*.py'`.

The launcher enforces a host deadline in addition to the Fleet runtime timeout.
`--grace-ms` defaults to 30000 for evidence export. Interrupted or timed-out
episodes are removed using their recorded container ID or a unique invocation
label. A failed cleanup cannot produce a successful exit code. `--keep-container`
retains normally stopped episodes for debugging, but does not retain timed-out
or interrupted episodes. Resource limits and input files are checked before launch.

On Linux, a new `--run-root` is private (0700). Its generated `workspace` and
`results` children allow the image's non-root UID to write; the private parent
prevents other host users from traversing them. An existing run root must already
be private. Explicit `--workspace`/`--results` paths keep their existing permissions
and must be writable by the image user. Do not mount the private parent into Agents.

This directory contains the reusable evaluation control plane. The Team runtime and
generic lifecycle APIs remain in the root package; benchmark adapters,
containers, fixed dependency matrices, and scenario overlays belong here or in
the long-lived `evaluation` branch.

The baseline is deliberately benchmark-neutral. It owns DSH/Fleet installation,
the headless lifecycle, Team bootstrap, resource limits, terminal-state handling,
and evidence export once. ALE, HorizonMath, SWE-style suites, and later benchmarks
should reuse it and supply only their task/data adapter, evaluator, Team choice,
and genuinely domain-specific tools.

The evaluation runner replaces DSH's default single-Agent headless completion
rule. It creates one Team through Fleet automatic bootstrap, lets the Team
assistant design and start the task DAG, subscribes in host code for the actual Work
terminal state, writes durable machine-readable output, and exits with a status
derived from the Work rather than the launcher's first turn.

## Required environment

- `FLEET_EVAL_TEAM_CONFIG`: absolute path to the Team JSON file.
- `FLEET_EVAL_OUTPUT`: absolute result directory. Defaults to
  `<workspace>/.fleet-evaluation/<run-id>`.
- `FLEET_EVAL_WORKSPACE`: absolute workspace path. Defaults to the process cwd.
- `FLEET_EVAL_TASK_FILE`: optional absolute authoritative task file. When
  omitted, the headless positional task is written to `task.md` in the result
  directory.
- `FLEET_EVAL_RUN_ID`: optional stable run id.
- `FLEET_EVAL_TIMEOUT_MS`: host-side timeout, defaulting to one hour.
- `FLEET_EVAL_PROVIDER`, `FLEET_EVAL_MODEL`, `FLEET_EVAL_MAX_TOKENS`, and
  `FLEET_EVAL_AGENT_PRESET`: optional request overrides.

Run the official DSH entry with Fleet installed in the `headless` profile and
apply the evaluation patch:

```sh
dsh --profile headless --patch /opt/dsh-fleet/evaluation/headless.patch.yml \
  "Complete the task in the configured task file."
```

The runtime writes `status.json`, `answer.txt`, `usage.json`,
`artifacts.json`, `events.jsonl`, and `bootstrap.json`. It does not require a
browser, global Harmony launcher, or model-driven polling.

## Runtime image

Build from the repository root. Dependency installation and Fleet profile
assembly happen during the image build, never during an evaluation episode:

```sh
docker build \
  --file evaluation/runtime.Dockerfile \
  --build-arg FLEET_REVISION="$(git rev-parse HEAD)" \
  --tag dsh-fleet-evaluation:baseline .
```

Run each episode through the common launcher. A provider-enabled image may be a
local private derivative of the baseline; benchmark code does not need to know
how that provider was installed:

```sh
node evaluation/run-container.mjs \
  --image dsh-fleet-evaluation:provider-local \
  --task "$PWD/task.md" \
  --run-root "$PWD/episode-001" \
  --env MODEL_API_KEY
```

The launcher consistently creates `/workspace` and `/results`, mounts the task
and Team config read-only, applies the 4 CPU / 8 GiB defaults, and passes secrets
by environment-variable name rather than embedding their values in commands.
Use repeatable `--mount` arguments for benchmark datasets and `--env-file` for a
private local provider configuration.

## Optional nested-container profile

The default `baseline` profile is sufficient when Agents can solve and validate
the benchmark inside the episode container. Keep it as the default because it is
smaller, starts faster, and does not require elevated container privileges.

Build the optional rootless Docker-in-Docker overlay only when a benchmark or
Team must create disposable child containers at runtime:

```sh
docker build \
  --file evaluation/dind.Dockerfile \
  --build-arg FLEET_BASE_IMAGE=dsh-fleet-evaluation:baseline \
  --build-arg FLEET_REVISION="$(git rev-parse HEAD)" \
  --tag dsh-fleet-evaluation:dind .

node evaluation/run-container.mjs \
  --profile dind \
  --task "$PWD/task.md" \
  --run-root "$PWD/episode-001" \
  --env MODEL_API_KEY
```

The launcher enables `--privileged` only for this explicit profile. The nested
daemon runs as the unprivileged `evaluator` account and uses its own ephemeral
image/container store; the host Docker socket is never mounted. Child containers
can affect the explicitly mounted episode workspace and results, but they cannot
see other host paths unless the launcher is given an additional mount. The outer
container's CPU, memory, and network boundaries remain the episode-wide ceiling.
Docker's rootless DinD image still requires a privileged outer container, so use
this profile only on a dedicated evaluation host or Docker Desktop VM.
Ubuntu 24.04 and newer may additionally restrict unprivileged user namespaces;
the host needs an appropriate rootlesskit AppArmor profile. Image CI uses an
Ubuntu 22.04 runner for DinD rather than changing the host's security settings.
See [Docker's rootless troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/).

For a conventional benchmark image, inherit the control plane and add only the
domain layer:

```dockerfile
ARG FLEET_BASE_IMAGE=dsh-fleet-evaluation:baseline
FROM ${FLEET_BASE_IMAGE}
USER root
# Install only benchmark-owned tools, for example a prover or repository runtime.
USER evaluator
```

Some suites, notably ALE and many SWE-style instance images, own their base image.
Those images reuse `install-headless-profile.sh` to assemble the exact same Fleet
profile instead of duplicating DSH plugin order and patch validation. This is the
portable fallback when inheriting the baseline is impossible.

The current Fleet package still declares Harmony as an install dependency for
the interactive product. The image therefore explicitly approves its build
script while assembling the profile, but does not install a global Harmony
launcher or start WebUI. Separating the host runtime package from the UI/Harmony
attachment remains a candidate for `main`; the evaluation branch must not
silently rewrite the published product manifest to achieve it.

The builder compiles only the Fleet host and its four internal runtime
packages. Web client, Lark, Git UI, and inspector attachments are intentionally
outside the evaluation image build graph.

The runtime stage includes Git and Python 3 as a small baseline coding
toolchain. Benchmark-specific compilers, provers, browsers, and datasets should
still be added by a scenario image derived from this base rather than installed
during an episode.

Alongside the summary files, a completed episode exports the flushed DSH
sessions to `dsh-sessions/` and the exact Team journal/state to `fleet-state/`.
These directories are evaluation evidence and must remain outside Git.

See `docs/architecture/evaluation-runtime.md` for the complete design and
[`BRANCH_BOUNDARY.md`](./BRANCH_BOUNDARY.md) for the concrete migration list.
