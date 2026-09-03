# dsh-agent-fleet

Agent development collaboration components for DeepSeek Harness.

Core, Message, Resources, and Authorization provide the runtime components. The root bundle also adds persistent
Team workflows and trace inspection. UI adds the embedded Team entry and startup configuration
surface to the native DSH Web new-session view.

Load `dsh-agent-fleet` to install the complete base runtime. Core, Message, Resources, Authorization, and the
connector gateway are internal modules bundled with the main plugin rather than separately installed plugins.

## Installation

### Ask an Agent to install it

The whole installation can be delegated with one message. Give this to any Agent that can use a terminal and open a
browser:

> 帮我在这台机器上安装 DeepSeek Harness 和 `dsh-agent-fleet` 插件。请严格按照
> https://github.com/CH4ACKO3/dsh-agent-fleet#installation 的当前说明执行，使用 npm 已发布版本，不要从源码安装，
> 并一并安装该章节推荐的 `@ch4acko3/dsh-turn-fold` 和 `dsh-render-engine` 公共渲染插件。
> 不要使用 headless 模式。缺少兼容的 Node.js 时也请一并安装。完成后启动 `web` profile，在浏览器中确认 WebUI
> 可以打开，并检查 Fleet patches 和 `the-binding-of-dsh/bidirectional-connection` 均为 `bound`。请持续处理到安装
> 成功或遇到需要我决定的明确阻塞，最后告诉我 WebUI 地址、安装的版本和验证结果。

The Agent should perform the commands below rather than merely describe them. It may ask before using administrator
privileges, but it does not need to ask about ordinary package installation, profile creation, startup, or verification.
Model credentials are configured separately in the WebUI and should not be requested or printed during installation.

### Install manually

Use Node.js `^22.22.3` or `>=24.11.1`. Install DeepSeek Harness first and Harmony second so Harmony owns the final
`dsh` launcher, then add Fleet to the Web profile:

```sh
npm install --global @deepseek-ai/dsh@0.1.1-rc.2
npm install --global dsh-harmony@^0.8.8
dsh plugin --profile web add dsh-agent-fleet@latest --allow-build=dsh-harmony
dsh web
```

`dsh web` stays in the foreground and normally opens the browser automatically. Keep it running, and verify the
installation from another terminal:

```sh
dsh --version
dsh --profile web --dump-config
dsh harmony status --json --profile web
```

The installation is complete when the WebUI opens, the resolved profile contains `dsh-agent-fleet`, and Harmony reports
the Fleet patches plus `the-binding-of-dsh/bidirectional-connection` as `bound`.

Fleet installs its compatible Harmony and The Binding of DSH (TBOD) packages into the profile. The separate global
Harmony installation is still required because its patches must run before the profile loads.

For the recommended Web experience, install
[`dsh-turn-fold`](https://github.com/CH4ACKO3/dsh-turn-fold) and the public service plugins from
[`dsh-render-engine`](https://github.com/CH4ACKO3/dsh-render-engine):

```sh
dsh plugin --profile web add @ch4acko3/dsh-turn-fold@latest

for package in \
  shiki syntax-highlight code-render markdown-render mermaid-render math-render \
  structured-render table-render code-frame-render diff-engine diff-render ansi-render
do
  dsh plugin --profile web add "@ch4acko3/dsh-${package}@latest"
done
```

`dsh-turn-fold` provides the visible compact turn UI. `dsh-render-engine` is the repository name rather than a
published root package; the commands above install its published renderer services so Web plugins can share syntax,
Markdown, Mermaid, math, structured-data, table, diagnostics, diff, and terminal rendering.

Install only the optional integrations that the profile uses:

```sh
dsh plugin --profile web add @ch4acko3/dsh-agent-fleet-git
dsh plugin --profile web add @ch4acko3/dsh-agent-fleet-lark
dsh plugin --profile web add dsh-agent-fleet-patchouli
```

Instead of the global Harmony command, Harmony can be installed into the profile first; on the next WebUI start, choose
**Install and restart** in Harmony's first-run dialog. `dsh plugin ... add` installs Fleet and appends its bundle to the
profile. If Fleet was installed with raw npm/pnpm instead, enable `dsh-agent-fleet` in DSH's plugin settings. Fleet
activates TBOD through Harmony automatically and reuses an already enabled TBOD bundle.

The `--allow-build` option permits only Harmony's required installer in the profile. If an older pnpm still reports
`Ignored build scripts: dsh-harmony`, approve it and rerun the Fleet add command so DSH can finish appending the bundle:

```sh
dsh plugin --profile web approve-builds dsh-harmony
dsh plugin --profile web add dsh-agent-fleet@latest --allow-build=dsh-harmony
```

Harmony's first-run gate reports a missing launcher; Fleet's plugin compatibility metadata reports unavailable packages
and version mismatches. Fleet does not switch to a fallback transport.

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
- `fleet_archive export` writes a complete archive for a paused or closed Team. Member Sessions, messages,
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
