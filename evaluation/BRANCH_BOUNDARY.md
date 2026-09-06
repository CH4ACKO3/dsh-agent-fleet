# Evaluation branch boundary

The `evaluation` branch is an integration and reproducibility branch, not a
second Fleet product line. It may depend on public Fleet lifecycle APIs, but it
must not carry private forks of Team, messaging, scheduling, or UI behavior.

## Keep on `evaluation`

The following content is benchmark- or harness-specific and should leave
`main` after the new runner has passed an end-to-end evaluation:

| Current path on `main` | Evaluation destination | Reason |
| --- | --- | --- |
| `integrations/agents-last-exam/**` | `evaluation/integrations/agents-last-exam/**` | ALE deployer, scenarios, model bridge, and image policy are external-evaluator concerns. |
| `examples/matilda-eval/**` | `evaluation/benchmarks/matilda/**` | Solver dependencies, network policy, Team configuration, and task material are scenario-specific. |
| `tests/matilda-eval-template.test.ts` | `evaluation/tests/matilda-template.test.ts` | The assertions protect one benchmark template rather than Fleet semantics. |

New benchmark adapters, pinned dependency matrices, container definitions,
network policies, resource limits, scoring scripts, and result-comparison tools
also remain on this branch.

Generated episode output must remain ignored and outside Git. A small,
deliberately curated fixture may be committed only when a deterministic test
needs it.

## Keep on `main`

These are reusable Fleet capabilities and should be promoted to `main` after
the evaluation branch proves them:

- `FleetRunService.wait()` and terminal-state correctness.
- Auto-bootstrap's optional host instruction, because self-evolution and other
  unattended hosts also need a one-shot policy overlay.
- The generic `dsh-agent-fleet/evaluation` host runner and its public types.
- Unit and mock-provider tests for headless Team lifecycle semantics.
- Fixes to session flushing, artifact indexing, token accounting, signals, and
  error normalization that apply to every Fleet host.

The generic runner is exposed only through the `./evaluation` package subpath;
it is intentionally not re-exported from the normal Fleet plugin entry. The
normal plugin therefore does not register evaluation behavior unless a profile
explicitly loads the evaluation runner.

## Migration procedure

1. Stabilize the generic runner and one mock-provider end-to-end test here.
2. Cherry-pick only the generic commits into `main`.
3. Remove the three benchmark-specific paths listed above from `main` in a
   separate cleanup commit.
4. Rebase `evaluation` onto that cleanup and keep benchmark files under the
   `evaluation/` tree.
5. Never merge the long-lived branch wholesale back into `main`; promote
   reviewed generic commits individually.

This ordering preserves the existing runnable material until its replacement
works, while preventing the benchmark files from silently returning to `main`.
