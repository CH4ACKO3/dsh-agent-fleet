# Matilda local Fleet evaluation kit

This directory turns the attached Matilda 16 × 16 task into a blind, repeatable local Fleet evaluation. It contains a four-member Team template, an answer-free task statement, and a pinned solver container derived from the local Fleet baseline.

The design uses four parallel evidence lanes rather than a chat-heavy sequence of research rounds:

1. construction search and witness validation;
2. mathematical lower-bound work;
3. two independent exact encodings;
4. adversarial small-instance checks and final reproduction.

The foreground assistant stages all lanes atomically, then waits. The terminal auditor packages evidence and casts the acceptance Vote. This keeps ordinary acknowledgements and solver chatter out of the user conversation while preserving a formal Task chain from kickoff through acceptance.

## Files

- `team.local.json`: importable local Team preset; names and model routes remain launcher-selected.
- `task.md`: authoritative blind benchmark and required staged plan. It intentionally contains no known optimum or prior construction.
- `Dockerfile` and `requirements.txt`: Python, Z3, OR-Tools CP-SAT, SciPy/HiGHS, and process instrumentation.
- `compose.yaml`: isolated DSH state volume, bind-mounted run workspace, configurable CPU/memory/time limits, and a loopback-only UI port.
- `compose.source.yaml`: optional override for testing a freshly packed Fleet source tree.

## Start a clean run on Windows PowerShell

Create a new host workspace and a unique Compose project for every evaluation. Do not reuse an old `/data` volume or output directory.

```powershell
$env:COMPOSE_PROJECT_NAME = 'matilda-eval-001'
$env:DSH_HOST_PORT = '3093'
$env:DSH_WORKSPACE = 'D:/Projects/DeepSeekHarness/evaluation-runs/matilda-001'
$env:DEEPSEEK_FLASH_API_KEY = '<local runtime key>'
New-Item -ItemType Directory -Force -Path $env:DSH_WORKSPACE

docker compose --project-directory examples/matilda-eval build
docker compose --project-directory examples/matilda-eval run --rm --no-deps --entrypoint python dsh /opt/matilda-eval/verify-environment.py
```

Prepare each empty run workspace by copying only the benchmark inputs:

```powershell
Copy-Item examples/matilda-eval/team.local.json $env:DSH_WORKSPACE/team.local.json
Copy-Item examples/matilda-eval/task.md $env:DSH_WORKSPACE/task.md
docker compose --project-directory examples/matilda-eval up -d
```

Open `http://127.0.0.1:3093/`. The two benchmark inputs are now available at stable container paths without exposing the source report or an earlier run's evidence.

Then tell the foreground assistant:

> 使用 `/workspace/team.local.json` 创建团队，并以 `/workspace/task.md` 作为任务开始盲测。按模板要求先暂存结构化 stages，再调用 start；不要在对话中自行解题。

Choose the provider/model at Team creation time. Blank routes in the preset deliberately inherit that selection and keep credentials and machine-specific routing out of version control.

## Test the current Fleet source instead of the image copy

Build a package from the Fleet worktree, then add the source override:

```powershell
pnpm pack --pack-destination D:/Projects/DeepSeekHarness/packages
$env:FLEET_PACKAGE_PATH = 'D:/Projects/DeepSeekHarness/packages/dsh-agent-fleet-0.2.0.tgz'
$env:FLEET_SOURCE_COMMIT = (git rev-parse --short HEAD)
docker compose --project-directory examples/matilda-eval -f examples/matilda-eval/compose.yaml -f examples/matilda-eval/compose.source.yaml up -d --build
```

Use an absolute `FLEET_PACKAGE_PATH` shared with Docker Desktop. Never place runtime keys in `.env.example`, Team JSON, task Markdown, or output artifacts.

When replacing a source tgz without changing its package version or path, use a new `COMPOSE_PROJECT_NAME` (and therefore a new `dsh-data` volume). pnpm may reuse the earlier file dependency from an existing profile even when the host tgz was overwritten, which makes a container appear updated while it still runs the previous package contents.

## Collect and reset

The terminal evidence is under `$env:DSH_WORKSPACE/e2e-output/matilda-eval/final/`. Preserve that directory together with the Team trace/export needed by the evaluation protocol.

Stop a run without deleting evidence:

```powershell
docker compose --project-directory examples/matilda-eval down
```

After collecting the run, remove only that run's isolated Compose volume:

```powershell
docker compose --project-directory examples/matilda-eval down --volumes
```

Changing `COMPOSE_PROJECT_NAME`, `DSH_HOST_PORT`, and `DSH_WORKSPACE` is sufficient to run another evaluation side by side. Keep solver limits and seed recorded with the result when comparing runs.

`MATILDA_PHASE1_BUDGET_SECONDS` bounds each complete phase-one lane; the Z3 and CP-SAT settings are per-call ceilings inside that total. Lane prompts require one foreground computation at a time and a formal Goal result at the deadline, so a slow experiment cannot silently strand the staged Task chain.

For cross-run comparison, use both mathematical outcome and collaboration cost. The task asks the final bundle to record member model steps, tool calls, aborted calls, Channel/private messages, Reply Tasks, idle recoveries, token usage when exposed, and solver wall time. A missing counter stays `null`; it must not be reconstructed from guesswork. This separates improvements in Team mechanics from changes caused only by a larger compute budget.
