# dsh-agent-fleet

Agent development collaboration components for DeepSeek Harness.

Core, Message, Resources, and Authorization provide the runtime components. The root bundle also adds persistent
Team workflows and trace inspection. UI adds the embedded Team entry and startup configuration
surface to the native DSH Web new-session view.

Load `dsh-agent-fleet` to install all implemented components together. They can also be loaded separately.

## Installation

Fleet installs its compatible Harmony and The Binding of DSH (TBOD) packages. Harmony still needs to own the
DSH launcher because its patches must run before the profile loads:

```sh
npm install --global dsh-harmony@^0.8.4
dsh plugin --profile web add dsh-agent-fleet
dsh web
```

Instead of the global command, Harmony can be installed into the profile first; on the next WebUI start, choose
**Install and restart** in Harmony's first-run dialog. Installing a package with `dsh plugin` does not by itself
enable its profile bundle, so enable `dsh-harmony` and `dsh-agent-fleet` in DSH's plugin settings when installing
from the terminal. Fleet activates TBOD through Harmony automatically and reuses an already enabled TBOD bundle.

If pnpm reports `Ignored build scripts: dsh-harmony`, approve that one package in the affected profile and retry:

```sh
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
pnpm approve-builds dsh-harmony
pnpm install
```

After startup, `dsh harmony status --profile web` must report Fleet patches and
`the-binding-of-dsh/bidirectional-connection` as `bound`. Harmony's first-run gate reports a missing launcher;
Fleet's plugin compatibility metadata reports unavailable packages and version mismatches. Fleet does not switch
to a fallback transport.

## Components

- `core` — registration, flat member lifecycle, control, and unified authorization.
- `resources` — Team resource-directory files, file/binary references, and advisory work paths.
- `message` — Fleet-scoped direct messages, Channels, Meetings, Votes, and shared Channel state.
- `authorization` — built-in groups, action permissions, and resource keycards using Core's single authorization path.
- `ui` — embedded Team entry and startup configuration surface for DSH Web.

## Team workflows

The root bundle adds lifecycle, archive, and trace tools:

- `fleet_run create` creates a persistent Team from a JSON initialization file in the
  calling session's current workspace. `fleet_run start` submits one Markdown work item to the idle
  Team. `finish` records that work's outcome and returns the same Team to idle; `close` explicitly
  retires the Team and releases its member Sessions. `resume` restores an idle or running Team after
  process restart.
- `fleet_trace` reads the durable Team coordination timeline or a member's native DSH Session events.
- `fleet_archive export` writes a complete archive for a paused Team. Member Sessions, messages,
  traces and Team resource files are always included; workspace files are opt-in.
  `fleet_archive import` creates a paused copy with new Team and Session ids by default; use
  `import_mode: "restore"` to preserve the archive identities for disaster recovery. Either mode can
  continue the same work through `fleet_run resume`.

Downstream plugins can register one archive contributor through `ctx.fleetArchives.register({ id,
save, restore })`. Fleet gives each contributor its own directory inside the archive. Data for a
plugin that is not installed on the destination is retained under the Team run directory and
reported as an unavailable extension instead of being discarded. During restore, contributors
receive the source Team and the source-to-imported Session id map so their own references can follow
a copied Team.

Each Team writes its workflow index, current/last work record, and cross-member coordination events
under Fleet-owned DSH storage. `<projectRoot>/.fleet/<team-id>/` contains only real Team resource files.
Complete member transcripts remain in the configured DSH Session persistence backend. Creating or resuming a Team therefore requires `sessionPersistence`;
Core, Message, and Resources remain independently usable without it.

The initialization format keeps Team identity and members under `core`, then stores settings
under module ids in `modules`. Fleet parses its message, resource, and UI blocks; installed plugins can
register a parser for their own block, while uninstalled module data remains intact. The Web client uses
the matching registry for optional settings editors and contributed templates. See
`examples/team-config.json` for the compact shape.
