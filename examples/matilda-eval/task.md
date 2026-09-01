# Blind evaluation: Matilda's 16 × 16 rectangle tiling

## Problem

Matilda has a 16 × 16 board of unit cells. She places axis-aligned rectangular tiles whose sides follow the grid. A cell is covered by at most one tile. In every row exactly one cell is uncovered, and in every column exactly one cell is uncovered.

Determine the minimum possible number of rectangular tiles.

## Required standard of evidence

The run is blind. Do not search the web, query external sources, or use a remembered/published answer or construction. Work only from this task and artifacts created in the current workspace.

A terminal optimum is accepted only when both sides meet at the same integer:

1. A machine-readable construction passes an independent cell-level verifier for bounds, rectangularity, non-overlap, and exactly one uncovered cell in every row and column.
2. An independent lower-bound route rules out every smaller tile count globally, including all possible permutations of uncovered cells. A solver timeout, one fixed permutation, random search failure, or unsupported lemma is not such evidence.

If the evidence does not close, report the strongest certified interval and the precise remaining gap. Do not force a predetermined numerical result.

## Atomic work plan

Before starting this Markdown, the foreground assistant must stage these formal Fleet Tasks in one directive and then call `fleet_run start` with this file as the authoritative source:

- `construction`: dependency-free Goal owned by the construction searcher. Produce `e2e-output/matilda-eval/construction/phase1.md`, `phase1.done`, a verifier, the best witness, commands, seeds, and logs.
- `theory`: dependency-free Goal owned by the lower-bound theorist. Produce `e2e-output/matilda-eval/theory/phase1.md`, `phase1.done`, a claim ledger, counterexample checks, and a clearly scoped lower bound.
- `exact`: dependency-free Goal owned by the exact-solver engineer. Produce `e2e-output/matilda-eval/exact/phase1.md`, `phase1.done`, two independent global encodings, small-n validation, commands, versions, and statuses.
- `independent-audit`: dependency-free Goal owned by the adversarial reproducer. Produce `e2e-output/matilda-eval/audit/phase1.md`, `phase1.done`, an independent small-n oracle, and a false-positive checklist.
- `package`: Goal owned by the adversarial reproducer and dependent on all four preceding stages. Independently replay and package the evidence.
- `acceptance`: Vote owned by the adversarial reproducer and dependent on `package`. Put this exact decision sentence in the stage `description` field (`statement` is not a valid stage field): "The final bundle contains a valid explicit construction and an independent global lower bound meeting at the same tile count, with runnable commands and hashes."

Do not replace these stages with informal messages or self-created shadow Tasks.

## Isolation and artifact protocol

Phase-one lanes are independent: do not inspect another lane until your own `phase1.md` and `phase1.done` exist. Each member writes only its lane directory. Use direct messages for narrow requests; use the main Channel only for a verified milestone, a contradiction affecting multiple lanes, or the final decision. A message requires a response only when the recipient is explicitly mentioned with `@`.

Within each lane's first two tool calls, create a checkpoint with scope, planned commands, seed where relevant, and a deadline derived from `MATILDA_PHASE1_BUDGET_SECONDS`. Checkpoint runnable source and current status before every solver call expected to exceed five minutes. Long-running commands must write logs incrementally. All algorithms must accept configurable time limits and seeds rather than embedding host-specific assumptions.

The phase-one budget is a total lane budget, not a per-command allowance. Do not start a command whose timeout exceeds the remaining lane time. Use no background solver processes and at most one foreground computation per lane; before retrying an aborted command, check whether its owned process is still alive and do not duplicate it. At the deadline, stop new experiments, record the strongest valid evidence, create `phase1.md` and `phase1.done`, and complete the formal Goal even when the result is incomplete. The audit lane is limited to exhaustive instances `n <= 6` during phase one and must not expand to `n >= 7`.

## Final bundle

The packaging stage must create:

- `e2e-output/matilda-eval/final/report.md`: conclusion, evidence classification, limitations, and exact rerun commands.
- `e2e-output/matilda-eval/final/result.json`: accepted/rejected status, certified lower/upper bounds, claimed optimum only when accepted, solver versions, seeds, elapsed times, artifact paths, and observable collaboration-cost counters. Include member model steps, tool calls, aborted tool calls, Channel/private messages, Reply Tasks, idle recoveries, and prompt/output tokens only when Fleet exposes authoritative counters. Use `null` plus a distinct reason key for each unavailable counter; never duplicate JSON keys or infer a value from UI prose.
- `e2e-output/matilda-eval/final/reproduce.sh`: non-interactive replay whose working directory is `/workspace`.
- `e2e-output/matilda-eval/final/manifest.sha256`: SHA-256 hashes of every terminal evidence artifact except the manifest itself. Every entry is relative to `/workspace`, and `reproduce.sh` verifies the manifest from `/workspace` rather than from the final subdirectory.

The final report must distinguish pure proof, exhaustive enumeration, global solver infeasibility, fixed-pattern computation, heuristic search, and unverified conjecture.
