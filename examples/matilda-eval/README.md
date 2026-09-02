# Matilda local Fleet evaluation kit

This directory turns the attached Matilda 16 × 16 task into a blind, repeatable local Fleet evaluation. It contains a four-member Team template, an answer-free task statement, and a pinned solver container derived from the local Fleet baseline. The mathematical input and evidence standard match the source scenario; the collaboration design is intentionally Fleet-native so coordination quality and cost can be compared without copying the source system.

The Team exposes four complementary capabilities rather than a chat-heavy fixed sequence of research rounds:

1. construction search and witness validation;
2. mathematical lower-bound work;
3. exact-model design and auditable feasibility or infeasibility evidence;
4. independent reproduction, adversarial validation, and acceptance review.

The foreground assistant reads the task and randomized roster, chooses which capabilities are relevant, and atomically creates a task-derived DAG. The template does not require all four members to receive equal work and does not prescribe construction, proof, exact solving, or audit as mandatory stages. It constrains only collaboration correctness: one owner per Goal, explicit dependencies and joins, durable continuation paths for long work, scoped handoffs, and independent acceptance when the task needs it. This keeps ordinary acknowledgements and solver chatter out of the user conversation without replacing the assistant's planning judgment with a benchmark-specific workflow.

The template deliberately does not encode a known answer, a benchmark-specific permutation family, a required stage topology, or a fixed round count. The authoritative task defines the acceptance evidence. A timeout, a selected set of fixed candidates, or agreement with a short numerical pattern cannot be promoted beyond the claim it actually supports.

## Files

- `team.local.json`: importable local Team preset; names remain randomized while the evaluation route is pinned to `memorax/deepseek-v4-flash` for reproducible cost and behavior comparisons.
- `task.md`: authoritative blind benchmark containing only the problem, expected evidence, and run isolation. It intentionally contains no known optimum, prior construction, timing policy, or prescribed collaboration plan.
- `Dockerfile` and `requirements.txt`: Python, Z3, OR-Tools CP-SAT, SciPy/HiGHS, and process instrumentation.
- `compose.yaml`: isolated DSH state volume, bind-mounted run workspace, configurable CPU/memory limits, a loopback-only UI port, and a kernel-enforced model-only egress guard.
- `compose.source.yaml`: optional override for testing a freshly packed Fleet source tree.

All solver dependencies are baked into the image. At runtime, the business container shares a guarded network namespace whose IPv4 and IPv6 output policies drop every new external connection except TCP `221.194.152.171:443`, the configured model endpoint. The business container has neither `NET_ADMIN` nor raw-socket capability, so an Agent shell cannot remove the guard. Docker DNS and all other external destinations remain unreachable.

## Start a clean run on Windows PowerShell

Create a new host workspace and a unique Compose project for every evaluation. Do not reuse an old `/data` volume or output directory.

```powershell
$env:COMPOSE_PROJECT_NAME = 'matilda-eval-001'
$env:DSH_HOST_PORT = '3093'
$env:DSH_WORKSPACE = 'D:/Projects/DeepSeekHarness/evaluation-runs/matilda-001'
$env:DEEPSEEK_FLASH_API_KEY = '<local runtime key>'
New-Item -ItemType Directory -Force -Path $env:DSH_WORKSPACE

docker compose --project-directory examples/matilda-eval build
docker compose --project-directory examples/matilda-eval run --rm --entrypoint python dsh /opt/matilda-eval/verify-environment.py
docker compose --project-directory examples/matilda-eval run --rm --entrypoint python dsh /opt/matilda-eval/verify-network-isolation.py
```

Prepare each empty run workspace by copying only the authoritative benchmark task. Keep the Team template outside `/workspace` and import it from this source directory so formal members cannot waste context rereading their own configuration:

```powershell
Copy-Item examples/matilda-eval/task.md $env:DSH_WORKSPACE/task.md
docker compose --project-directory examples/matilda-eval up -d
```

Open `http://127.0.0.1:3093/`, choose `/workspace`, and import `examples/matilda-eval/team.local.json` from the host. The authoritative task is available at a stable container path without exposing the Team configuration, source report, or an earlier run's evidence to members.

Then tell the foreground assistant:

> 请按 `/workspace/task.md` 开始任务。

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

Changing `COMPOSE_PROJECT_NAME`, `DSH_HOST_PORT`, and `DSH_WORKSPACE` is sufficient to run another evaluation side by side. Record any solver limits or seeds actually chosen during a run when comparing results.

For cross-system comparison, hold the problem and terminal evidence standard constant, then compare both mathematical outcome and collaboration cost. The Fleet Team template asks the final bundle to record member model steps, tool calls, aborted calls, Channel/private messages, Reply Tasks, idle recoveries, token usage when exposed, and solver wall time. A missing counter stays `null`; it must not be reconstructed from guesswork. This lets the evaluation test whether Fleet reaches equally strong evidence with fewer coordination turns and less auxiliary context.
