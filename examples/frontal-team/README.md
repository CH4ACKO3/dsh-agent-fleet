# Frontal Team preset adaptations

The files in `teams/` adapt the four built-in Team templates from
`/Users/ch4acko3/Documents/Frontal Lobe plugin-frontal-team` to this project's modular Team
configuration and local-preset import format.

- The presets keep stable Team identity and members under `core`, with message, resource, UI, and optional plugin settings under `modules`.
- Source member roles and detailed prompts are retained. Their prompts also identify each Agent as a
  stable core member that preserves durable evidence and handoffs while involving peers on demand.
- Team-level preferences keep the user outside the coordination hot path, use Channels and shared
  artifacts as project memory, favor decentralized ownership, and require independent review.
- `editor` metadata preserves the shared-resource selections when a file is imported and saved as a
  browser-local Team preset. The runtime ignores that metadata when the JSON is used directly.
- `member-presets/` contains a complete 16-role member library plus one export-compatible file per
  logical role. Use its aggregate file when importing so the current replace-style importer retains
  every Frontal role.
- `field-presets/` contains complete bilingual copy for additional durable rules, Kanban/Agile/
  stage-gated and contract-first collaboration patterns, and user-facing content lenses. It is a copy
  catalog because the current UI does not import field collections from JSON.

The Web configuration surface has two browser-local stores: complete imported or saved Team presets
use `dsh-agent-fleet.team-presets`, while reusable member and field-preset definitions use
`dsh-agent-fleet.preset-library.v1`. These files are complete Team presets; importing one writes the
first store, but merely keeping the file in the repository does not modify browser state.

- `tasks/realpde.md` is the RealPDE development task.
- `tasks/riemann-h0.md` and `tasks/riemann-h1.md` pair with `teams/research.json`.
  They use `tools/arxiv-filter.mjs`; set `FLEET_LITERATURE_CUTOFF=YYYY-MM-DD` before launching DSH.
- `teams/research-livestream.local.json` is the removable browser-local “直播科研团队”
  template. Import it through the Team template picker; it is intentionally not included in the
  built-in template catalog.

The root `dsh-agent-fleet` plugin loads these files through `fleet_run create`. Fleet adds the default
access and current communication model without inserting a coordinator Agent. Work Markdown is submitted later through
`fleet_run start`, and the same persistent Team can accept another work item after `fleet_run finish`.
Frontal Team-specific Desk behavior and runtime gates are intentionally expressed as current-project
preferences rather than reproduced as unsupported mechanisms.
