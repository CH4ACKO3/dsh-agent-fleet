# dsh-agent-fleet

Agent development collaboration components for DeepSeek Harness.

Core and Message contain the first process-local runtime slices. Resources and UI remain structural placeholders and will be added incrementally.

## Components

- `core` — registration, control, shared contracts, and common foundations.
- `resources` — resources, workspaces, and storage.
- `message` — direct messages, channels, meetings, and agent coordination.
- `ui` — future fleet management and inspection surfaces.

The detailed ownership and dependency rules are defined in
[`docs/architecture/modules.md`](docs/architecture/modules.md).

Architecture notes, decisions, and protocol documents live under `docs/`.
