# Frontal Team field preset copy

`frontal-team-field-preset-additions.json` contains copy-ready additions for the Fleet Web
configuration surface's `rules`, `collaboration`, and `content` field preset collections. Every entry
uses the current `FieldContentPreset` shape: `id`, bilingual `name`, and bilingual `detail`.

The catalog adds:

- six durable Team rules covering authoritative state, independent acceptance, bounded escalation,
  on-demand activation, failure memory, and selection of one primary method per work item;
- four executable collaboration patterns: Kanban flow, Agile iteration, stage-gated delivery, and
  contract-first parallelization;
- five user-facing content lenses: executive sponsor, product lead, technical lead, project manager,
  and evidence pack.

Incident war-room copy is intentionally deferred. Contract-first parallelization is a bounded pattern
inside the selected primary lifecycle, so it may accompany Kanban, Agile, or stage-gated work without
creating a second cadence. The other three lifecycle modes are mutually exclusive for one work item.

## Fleet tool semantics reflected in the copy

- `fleet_task` has `open`, `in_progress`, `blocked`, `completed`, and `cancelled`; it does not have
  native `Ready` or `Review` columns or an explicit dependency field. Review is therefore a child task
  or an explicit reviewer entry, and dependencies are recorded in task descriptions, hierarchy, and
  resources.
- `fleet_vote` uses `start_work` for the initial work-plan commitment, `message` for later Sprint,
  method, contract, or phase-gate decisions, and reserves `finish` / `blocked` for the terminal state
  of the whole work item. Voters are named explicitly for bounded contract and gate decisions.
- `fleet_schedule` provides asynchronous recurring checks and targeted wakeups; `fleet_calendar`
  provides real planning, review, retrospective, and phase-gate dates.
- `fleet_meeting` is used only when several roles need bounded synchronous alignment. Closing a Meeting
  persists its summary, decisions, task-linked actions, and resources.
- `fleet_member` and `fleet_workspace` support scoped specialists and isolated parallel ownership.

Rules and content lenses can be combined. Select one primary lifecycle per work item and use the
`one-primary-method` rule whenever several preferences are available.

The content lenses define stable response sections but do not change internal responsibility,
acceptance, or evidence requirements. Forecast dates and confidence must be grounded in completed
criteria, remaining critical-path work, and known dependencies rather than unsupported percentages.

## Current integration boundary

The current UI can create field presets interactively and persists them under
`dsh-agent-fleet.preset-library.v1`, but its JSON import path imports member presets rather than the
`fields` collection. This file is therefore a reviewable copy catalog, not a directly importable UI
payload. Its `detail` values can be copied into full Team presets now; making these entries built-in or
adding field-library import requires a later UI change.
