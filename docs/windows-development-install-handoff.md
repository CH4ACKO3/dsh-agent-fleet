# Windows development installation handoff

Last updated: 2026-08-28

This document is the expected clean-install path for moving Fleet development to a Windows x64 machine. The public
package set resolves for Windows, and the profile composition described below has been cold-start checked on a clean
macOS `DSH_HOME`. The receiving Windows agent still owns the first real Windows runtime test and any platform repair.

## Target layout

Use three separate roots:

| Purpose | Expected path |
| --- | --- |
| DSH runtime data | `%USERPROFILE%\.dsh` |
| Web profile | `%USERPROFILE%\.dsh\profiles\web` |
| Development repositories | `%USERPROFILE%\Documents\dsh-dev\<repository>` |

The initial runtime must use registry packages. Do not copy macOS `node_modules`, pnpm links, `/Users/...` profile
entries, or launchd files. Start the Web instance on `127.0.0.1:3080`.

Keep model providers and memory integrations separate. This public guide includes the public Patchouli memory stack,
but it must not install the internal `dsh-llm-memorax` model provider, its local bridge, its gateway configuration, or
its credentials. Public Memorax memory plugins are independent integrations and are not internal model providers.

## Loading model

Use Harmony loading only where the package contract supports it:

- `dsh-agent-fleet` declares `dsh.harmony.requires` for `the-binding-of-dsh`. Install Binding as a dependency, but do
  not list it in `dsh.profile.bundles`; Harmony adds its bundle as a temporary startup layer without duplicating the
  Loader entry.
- `dsh-patchouli-native-context-service` is a Cordis service, not a Harmony Provider. Install it as a dependency, but
  do not list it in `dsh.profile.bundles`. `dsh-agent-fleet-patchouli` inserts its Loader entry exactly once.
- `harmony.json` controls Harmony Provider and Patch order. It does not activate arbitrary Cordis services.

After the profile is assembled, manage its dependencies with `pnpm --dir <profile> ...`, not `dsh plugin ...`.
`dsh plugin` reconciles every direct bundle dependency and would re-add the native-context bundle, producing the known
`duplicate loader entry id: patchouli-native-context` failure.

## 1. Install the host tools

Run PowerShell 7 as the normal user:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Git.Git --exact
winget install --id Microsoft.PowerShell --exact
```

Open a new PowerShell window, then install the pinned launcher and package manager:

```powershell
npm install --global pnpm@11.19.0 @deepseek-ai/dsh@0.1.1-rc.2

node --version
pnpm --version
dsh --version
git --version
pwsh --version
```

Node must satisfy `^22.22.3 || >=24.11.1`; prefer Node 24.11.1 or newer.

## 2. Initialize a clean profile

```powershell
$DshHome = Join-Path $env:USERPROFILE ".dsh"
$ProfileDir = Join-Path $DshHome "profiles\web"
$env:DSH_HOME = $DshHome
[Environment]::SetEnvironmentVariable("DSH_HOME", $DshHome, "User")

dsh plugin --profile web install
```

Before adding Harmony, set `%DSH_HOME%\profiles\web\pnpm-workspace.yaml` to:

```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

allowBuilds:
  dsh-harmony: true
```

Keep any `minimumReleaseAgeExclude` entries that pnpm adds later. `autoInstallPeers` remains false because the in-box
DSH prereleases are published under the `next` tag and generic peer auto-install can select an unavailable stable
range.

## 3. Install the public runtime stack

Use raw pnpm so installation and Loader activation remain separate:

```powershell
$RuntimePackages = @(
  "dsh-harmony@0.8.8"
  "the-binding-of-dsh@0.1.7"
  "dsh-agent-fleet@0.2.0"
  "@ch4acko3/dsh-agent-fleet-git@0.1.0"
  "dsh-agent-fleet-patchouli@0.1.3"
  "dsh-patchouli@0.1.6"
  "dsh-patchouli-native-context-service@0.1.6"
  "dsh-patchouli-memory-ui@0.1.0"
  "dsh-webui-studio@0.2.1"
  "@ch4acko3/dsh-turn-fold@0.4.2"
  "@ch4acko3/dsh-ansi-render@0.1.2"
  "@ch4acko3/dsh-code-frame-render@0.1.2"
  "@ch4acko3/dsh-code-render@0.1.2"
  "@ch4acko3/dsh-diff-engine@0.1.2"
  "@ch4acko3/dsh-diff-render@0.1.3"
  "@ch4acko3/dsh-markdown-render@0.1.2"
  "@ch4acko3/dsh-math-render@0.1.1"
  "@ch4acko3/dsh-mermaid-render@0.1.1"
  "@ch4acko3/dsh-shiki@0.1.2"
  "@ch4acko3/dsh-structured-render@0.1.2"
  "@ch4acko3/dsh-syntax-highlight@0.1.1"
  "@ch4acko3/dsh-table-render@0.1.2"
)

pnpm --dir $ProfileDir add @RuntimePackages
```

`dsh-hover-hint@0.1.0` arrives through `dsh-agent-fleet`; it is a shared module rather than a profile bundle.

Set `dsh.profile.bundles` in `%DSH_HOME%\profiles\web\package.json` to the following explicit order:

```json
[
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dsh-harmony",
  "dsh-patchouli",
  "dsh-patchouli-memory-ui",
  "dsh-agent-fleet",
  "dsh-agent-fleet-patchouli",
  "@ch4acko3/dsh-agent-fleet-git",
  "@ch4acko3/dsh-turn-fold",
  "@ch4acko3/dsh-shiki",
  "@ch4acko3/dsh-syntax-highlight",
  "@ch4acko3/dsh-code-render",
  "@ch4acko3/dsh-mermaid-render",
  "@ch4acko3/dsh-math-render",
  "@ch4acko3/dsh-markdown-render",
  "@ch4acko3/dsh-structured-render",
  "@ch4acko3/dsh-table-render",
  "@ch4acko3/dsh-code-frame-render",
  "@ch4acko3/dsh-diff-engine",
  "@ch4acko3/dsh-diff-render",
  "@ch4acko3/dsh-ansi-render",
  "dsh-webui-studio"
]
```

Intentionally absent from this array:

- `the-binding-of-dsh`: activated through Fleet's Harmony requirement.
- `dsh-patchouli-native-context-service`: inserted by Fleet Patchouli.
- `dsh-hover-hint`: ordinary shared module.

Do a real Loader preflight; `--dump-config` alone does not instantiate the Cordis tree and therefore cannot detect
duplicate entry IDs:

```powershell
dsh web --help
```

This command must exit normally. If it reports a duplicate `patchouli-native-context`, first remove
`dsh-patchouli-native-context-service` from `dsh.profile.bundles`; keep it in `dependencies`.

## 4. Configure the public memory stack

Patchouli is a public memory integration. It does not require or imply the internal Memorax model provider or bridge.
Configure the model provider and its credentials separately through the standard DSH model settings for the target
deployment.

Add this entry to `%DSH_HOME%\profiles\web\cordis.patch.yml`:

```yaml
- id: patchouli
  config:
    retrieveTimeoutMs: 120000
```

For the first run, start Web interactively:

```powershell
$env:DSH_HOME = Join-Path $env:USERPROFILE ".dsh"
dsh web --port 3080
```

Only after the interactive run succeeds should the Windows agent turn this command into a startup task or service.

## 5. Optional integrations

Install Lark only when its credentials will be configured:

```powershell
pnpm --dir $ProfileDir add "@ch4acko3/dsh-agent-fleet-lark@0.1.0"
```

Then add `@ch4acko3/dsh-agent-fleet-lark` to `dsh.profile.bundles`. Do not use `dsh plugin add`, because it will also
reconcile unrelated direct dependencies into the bundle list.

The following third-party memory packages may be installed for compatibility, but must stay disabled. Install them
only after the core Fleet/Patchouli path works:

```powershell
$CompatibilityMemoryPackages = @(
  "@furongjun1999/dsh-memory@0.2.8"
  "@memtensor/memos-local-plugin@2.0.16-beta.1"
  "@modusensus/dsh-mneme@0.3.7"
  "@openviking/dsh-memory-plugin@0.1.0"
  "@vectorize-io/hindsight-coding-agents@0.3.4"
  "dsh-engramory@0.2.0"
  "dsh-memory-gate@0.9.0"
  "dsh-mnemon@0.1.6"
  "graph-memory@1.5.8"
)

pnpm --dir $ProfileDir add @CompatibilityMemoryPackages
```

If their bundles are added to the profile for configuration compatibility, keep these Loader IDs disabled in
`cordis.patch.yml`:

```yaml
- id: dsh-memory
  disabled: true
- id: memos-local-memory
  disabled: true
- id: dsh-mneme
  disabled: true
- id: openviking-memory
  disabled: true
- id: hindsight
  disabled: true
- id: engramory
  disabled: true
- id: memory-gate
  disabled: true
- id: mnemon
  disabled: true
```

`dsh-memory-evolve@0.1.0` is a private third-party tarball, not a public release. If compatibility with it is needed,
copy the artifact separately to `%DSH_HOME%\artifacts\profile-web-local-plugins\` and install it with raw pnpm. It is
not required for the Fleet/Patchouli memory path.

Do not install the deprecated `dsh-ui-container` or `dsh-ui-workspace`. Frontal Lobe is currently macOS Apple Silicon
only and is outside the Windows profile.

## 6. Development checkouts

After the registry runtime works, clone only the repositories being changed under
`%USERPROFILE%\Documents\dsh-dev`:

```powershell
$DevRoot = Join-Path $env:USERPROFILE "Documents\dsh-dev"
New-Item -ItemType Directory -Force $DevRoot | Out-Null
Set-Location $DevRoot

git clone https://github.com/CH4ACKO3/dsh-agent-fleet.git
git clone https://github.com/memorax-ai/dsh-patchouli.git Patchouli
git clone https://github.com/memorax-ai/dsh-webui-studio.git
git clone https://github.com/CH4ACKO3/dsh-render-engine.git
git clone https://github.com/CH4ACKO3/dsh-turn-fold.git
git clone https://github.com/memorax-ai/dsh-harmony.git
git clone https://github.com/CH4ACKO3/the-binding-of-dsh.git
```

Run `pnpm install` and the repository's own build/check command inside the repository being edited. Keep the clean
registry profile as the baseline; link only the package currently under development, using raw pnpm, and restore its
pinned registry version before judging an installation or release failure.

## 7. Data migration

First prove a new empty team works. Then migrate data, not runtime installation state:

- Fleet teams: old `~/.dsh/dsh-agent-fleet` to `%DSH_HOME%\dsh-agent-fleet`.
- Sessions: copy only after deciding whether macOS absolute workspace paths should be retained as history or remapped.
- Patchouli storage: migrate after the Windows daemon has created and opened a fresh database successfully.
- Never copy the old `profiles\web\node_modules`, source links, pnpm lockfile, Harmony generated state, or launchd files.

## Windows acceptance checklist

The receiving agent should not call the migration complete until all of these pass:

1. `dsh web --help` builds the Loader tree without duplicate IDs.
2. `dsh web --port 3080` serves the UI and survives a cold restart.
3. A team can be created, all assistants load, and a parsed mention creates a persistent Reply Task that remains active until `fleet_reply` delivers its content and receipt.
4. The deployment's configured public model provider completes a normal request.
5. Patchouli records the interaction, and a later request retrieves it through the configured retrieval model.
6. Markdown rendering, source/comparison views, Git integration, and the budget panel load without browser errors.
7. The Patchouli Windows daemon restarts with the Web process and preserves its database.

Session Archive and Joyride remain unpublished optional Fleet integrations. Their absence should be recorded as an
optional capability gap, not treated as a failure of the core Windows install.
