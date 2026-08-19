# dsh-agent-fleet

Agent development collaboration components for DeepSeek Harness.

This repository is currently in its structure-only bootstrap stage. Runtime code, package manifests, dependencies, and build configuration will be added incrementally.

## Components

- `core` — fleet coordination, agent registry, task lifecycle, leases, and team events.
- `protocol` — shared task, message, artifact, and result contracts.
- `transport-interconnect` — cross-instance transport integration.
- `behavior-tree` — optional behavior-tree policy and orchestration.
- `resources` — shared-resource metadata and access boundaries.
- `workspace-git` — isolated worktrees, change publication, and merge coordination.
- `review` — verification, review, and acceptance workflows.
- `observability` — fleet traces, timelines, status, and cost signals.
- `ui` — fleet management and inspection surfaces.

Architecture notes, decisions, and protocol documents live under `docs/`.
