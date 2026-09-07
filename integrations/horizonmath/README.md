# HorizonMath with Fleet

This integration runs the actual [HorizonMath benchmark](https://github.com/ewang26/HorizonMath), pinned to
`3259167b263ecd054315a41e42a726e834a9122f`. That checkout contains **136 problems**; README and website counts
may describe earlier revisions. Its `data/problems_full.json` SHA256 is
`5dfcf8c3964b2d4050ddf3095d390fdac4edea3d88ac42f99abb07c13cc0e7de`.

## Prepare and run

Run from the Fleet repository root on a Linux Docker host. The exported prompts contain the official system
instructions and problem statement, with an added destination for `proposed_solution()`. Reference-value fields
are excluded. Keep the official checkout and grader output outside agent-mounted workspaces.

```sh
git clone https://github.com/ewang26/HorizonMath.git /srv/benchmarks/HorizonMath
git -C /srv/benchmarks/HorizonMath checkout --detach 3259167b263ecd054315a41e42a726e834a9122f
python3 integrations/horizonmath/prepare.py \
  --checkout /srv/benchmarks/HorizonMath --output /srv/benchmarks/horizonmath-prompts
docker build -f integrations/horizonmath/grader.Dockerfile -t dsh-horizonmath-grader:3259167b263e .
docker build -f evaluation/runtime.Dockerfile -t dsh-fleet-evaluation:baseline .
docker build -f integrations/horizonmath/runtime.Dockerfile -t dsh-horizonmath-fleet:baseline .
python3 evaluation/batch-run.py \
  --manifest /srv/benchmarks/horizonmath-prompts/manifest.json \
  --output /srv/benchmarks/runs/horizon-001 --image dsh-horizonmath-fleet:baseline \
  --parallel 2 --cpus 4 --memory 8g --timeout-ms 3600000 --retries 1 --env DEEPSEEK_API_KEY
```

The generic image uses the configured official DSH provider. Provider-specific runtime derivatives must supply
their own existing configuration. `server-runtime.Dockerfile` is specifically for the preexisting provider-enabled
ALE image on `cuhksz106_zzr`; it does not upload or embed a local private provider package or credential.

Repeat exactly the same batch command with `--resume` to reuse completed attempts. Source identity, image IDs,
prompt/config/team hashes and runtime settings must still match. Change the output root for a changed experiment.
`--task ID` is repeatable. Wrong answers and indeterminate official results are not automatically retried.

The controller writes `batch.json`, one directory per task/attempt, `agent.log`, `grader.log`, `official-result.json`
and a sanitized `result.json`. It writes status counts, completed-only mean and a lower-bound score with all selected
tasks in the denominator to `summary.json`. An interrupted process which leaves `.running` must be inspected
before manually recovering that attempt; do not remove a live lock.

## Curriculum protocol

Configure the host curriculum's benchmark command as:

```json
["python3", "/srv/fleet/evaluation/batch-run.py", "--job", "{job}"]
```

Jobs use `schemaVersion:1`, `task` from this manifest, `output`, `sourceWorkspace`, `sourceCommit`, `split`,
`generation`, `timeoutMs` and an explicit `image`. The image OCI revision must match the frozen candidate commit.
The trusted host launches the image; candidate code cannot replace the host launcher. Reserve an additional
900 seconds for grading plus cleanup beyond the agent timeout.

For an offline multi-generation curriculum, initially select `benchmark_best_known` and `new_construction`
tasks and make sure every split is nonempty. Correct numeric tasks need the official compliance judge;
without that separate service they become indeterminate, which cannot support automatic generation promotion.

## Scoring and isolation limits

- The grader uses the official `evaluate_response` implementation, including closed-form compliance checks.
  Numerically correct but unreviewed solutions are `indeterminate` with `score:null`. Matching an existing
  best-known baseline is not counted as an improvement.
- The default grader has no network or credentials. Numeric compliance needs a future separate trusted judge
  stage; passing credentials to untrusted solution code is not an acceptable workaround.
- The upstream execution sandbox runs solution code in a subprocess, so malicious code can still read data
  inside the grader image. The current agent/grader container split is not a complete anti-cheating boundary.
  Do not use current scores as adversarially secure research evidence. A separate witness-execution container
  and trusted grading process are required before making that claim.
- Some validators need SageMath, which this first Python-lockfile image does not install. Flag missing-runtime
  tasks as infrastructure failures. The full upstream lock includes PyTorch/CUDA, so its build is relatively large.

## Current server deployment

The 2026-09-08 deployment is under `/data/zzr/dsh-agent-fleet-evaluation-20260908` on `cuhksz106_zzr`.
Use `/home/zzr/.nvm/versions/node/v24.12.0/bin` on PATH. `source/` holds the source snapshot,
`manifests/horizonmath/` holds 136 public task prompts, and `runs/` holds private episode evidence.
The existing server credential file is `secrets/provider.env` (0600); no credential value belongs in logs or Git.
The source snapshot is marked `working-snapshot-20260908` until a final committed build is produced.

See [the deployment report](../../docs/reports/benchmarks-server-20260908.md) for actual run outcomes and blockers.
