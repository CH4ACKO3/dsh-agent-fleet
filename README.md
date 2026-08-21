# dsh-agent-fleet

Agent development collaboration components for DeepSeek Harness.

Core, Message, and Resources provide the runtime components. The root bundle also adds persistent Team runs and trace inspection. UI remains a structural placeholder.

Load `dsh-agent-fleet` to install all three implemented components together. They can also be loaded separately.

Install it as a DSH profile layer with `dsh plugin --profile <profile> add dsh-agent-fleet`.

## Components

- `core` — registration, flat member lifecycle, control, and a shared project root.
- `resources` — shared plan/checklist files, file/binary references, and advisory work paths.
- `message` — Fleet-scoped direct messages, Channels, Meetings, Votes, and shared Channel state.
- `ui` — future fleet management and inspection surfaces.

## Team runs

The root bundle adds two tools:

- `fleet_run` starts a Frontal Team-style JSON template with a Markdown task, resumes an unfinished
  running Team after process restart, then lists, inspects, waits for, or explicitly ends the run.
- `fleet_trace` reads the durable Team coordination timeline or a member's native DSH Session events.

Each run writes only its Team index and cross-member coordination events under
`.fleet/runs/<run-id>/`. Complete member transcripts remain in the configured DSH Session
persistence backend. Starting a run therefore requires `sessionPersistence`; Core, Message, and
Resources remain independently usable without it.
