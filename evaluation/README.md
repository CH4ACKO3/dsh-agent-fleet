# Fleet evaluation runtime

This directory contains evaluation-only profile wiring. The Team runtime and
generic lifecycle APIs remain in the root package; benchmark adapters,
containers, fixed dependency matrices, and scenario overlays belong here or in
the long-lived `evaluation` branch.

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
  --tag dsh-fleet-evaluation:local .
```

Run each episode in a fresh container and mount the Team configuration, task,
workspace, and result directory explicitly:

```sh
docker run --rm --cpus 4 --memory 8g \
  -e FLEET_EVAL_TEAM_CONFIG=/evaluation/team.json \
  -e FLEET_EVAL_TASK_FILE=/evaluation/task.md \
  -e DEEPSEEK_API_KEY \
  -v "$PWD/team.json:/evaluation/team.json:ro" \
  -v "$PWD/task.md:/evaluation/task.md:ro" \
  -v "$PWD/workspace:/workspace" \
  -v "$PWD/results:/results" \
  dsh-fleet-evaluation:local
```

The current Fleet package still declares Harmony as an install dependency for
the interactive product. The image therefore explicitly approves its build
script while assembling the profile, but does not install a global Harmony
launcher or start WebUI. Separating the host runtime package from the UI/Harmony
attachment remains a candidate for `main`; the evaluation branch must not
silently rewrite the published product manifest to achieve it.

The builder compiles only the Fleet host and its four internal runtime
packages. Web client, Lark, Git UI, and inspector attachments are intentionally
outside the evaluation image build graph.

See `docs/architecture/evaluation-runtime.md` for the complete design and
[`BRANCH_BOUNDARY.md`](./BRANCH_BOUNDARY.md) for the concrete migration list.
