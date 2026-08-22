# Fleet reliability soak

Run a sustained, read-only reliability review of the current `dsh-agent-fleet` workspace. Do not
change product source files. The Team may create or update only `.fleet/` shared state and files
under `e2e-output/`.

Coordinate in the main Channel and use at least one Meeting. Assign non-overlapping ownership for:

1. lifecycle and restart/resume behavior;
2. messaging, Meetings, Votes, and assistant participation;
3. resources, workspace boundaries, and persistent trace observability.

Run the repository's existing test and build commands, inspect the current implementation and the
persisted container-resume run, and record concrete evidence rather than assumptions. Create
`e2e-output/fleet-longrun-report.md` with the current findings, commands run, failures or risks,
owners, and the next checkpoint. Register the report with `fleet_resource`. A member other than the
report owner must independently inspect it and report verification in the main Channel.

Do not open a `finish` Vote until `e2e-control/allow-longrun-finish` exists. While it is absent, keep
the Team and work item running, publish a concise checkpoint in the main Channel, and remain
available for later follow-up. Do not invent missing RealPDE, Riemann, corpus, checkpoint, or data
mounts; record those migrated tasks as unavailable external dependencies instead.
