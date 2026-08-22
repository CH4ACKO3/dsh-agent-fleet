# Fleet core slimming handoff

## Goal

Keep `dsh-agent-fleet` useful without optional plugins, but limit it to the Team runtime and safe defaults. Optional plugins own advanced policy authoring and productivity features.

The base plugin owns enforcement. Enhancers may refine policy, but the base plugin must still start, collaborate, persist, resume, archive, and enforce static permissions without them.

## Base plugin after slimming

The base keeps:

- Team, member, DSH Session, work, pause/resume/close, restart recovery, and archive lifecycle.
- Channels, direct messages, meetings, delivery/wakeup, user observer/controller access, and member runtime status.
- One authorization language and final decision service for members, assistants, external callers, and system operations.
- Static per-member tool groups and action permissions as the no-plugin baseline.
- One primary workspace per member, materialized as the DSH Session `cwd`, plus the native DSH sandbox mode.
- One real Fleet-managed Team resource directory at `<projectRoot>/.fleet/<teamId>/`.
- Generic shared-directory operations and ordinary file/resource references; no predefined Team filenames.
- Advisory work claims used to reduce accidental concurrent edits.
- Configuration, archive, projection, Web Remote, UI shell, and the small extension seams needed by optional plugins.

The resource directory is the only built-in Team file convention. Its location does not imply that every member can access every file: concrete operations still pass through unified authorization. Authorized members decide whether it contains `plan.md`, `rules.md`, datasets, reports, binaries, or any other files. Different Teams attached to the same project receive separate `.fleet/<teamId>/` directories. Archive export always includes the selected Team's directory, independently of the option to include the rest of the workspace.

Fleet's private runtime records must not remain inside this member-writable directory. Team records, journals, revisions, extension state, and import staging move to Fleet/DSH-owned storage. `<projectRoot>/.fleet/<teamId>/` contains that Team's shared work product only.

The base does not depend on Permissions, Access, Git, Documents, Tasks, Calendar, or Schedule plugins.

## Unified authorization

Core owns the only authorization language and final decision entry point:

```ts
authorize({
  teamId,
  subject: { kind: 'member' | 'assistant' | 'external' | 'system', id },
  action: string,
  resource?: { kind: string, id: string },
}): boolean

require(input): void
```

`FleetAuthorizationService` replaces the current action-only `FleetAccessService`. It registers namespaced actions and resource kinds, resolves the static baseline or the installed provider for each side of the decision, and returns the final result. Permissions is authoritative for the action side when installed; otherwise Core uses the static baseline. Access is authoritative for registered resource instances when installed; otherwise Core uses its built-in resource relations. Unknown actions and unknown resource kinds are denied.

The decision is:

```text
actionAllowed && (resource is absent || resourceAllowed)
```

Tool groups remain a coarse discovery and exposure mechanism. They may hide tools that have no usable actions, but seeing a tool never authorizes a call. Every real business operation calls `require()` with its concrete action and, when applicable, concrete resource. For example, exposing `fleet_send` may follow `message.post`, while posting to a private Channel still requires `message.post` on that Channel resource.

Without optional policy plugins, Core provides these safe defaults:

- Static member/assistant `toolGroups` and `permissions` determine allowed registered actions.
- External and system subjects receive only explicitly registered Core operations; neither identity implies blanket authority.
- The Team's primary workspace, configured actions, concrete resource policy, and conversation membership determine allowed built-in resources; directory placement alone grants nothing.
- Native file tools remain confined by the subject's DSH Session `cwd` and sandbox mode.
- Team shared-directory operations remain confined to `<projectRoot>/.fleet/<teamId>/`.
- Registering a file reference does not widen the native DSH sandbox.

Permissions supplies action policy. Access supplies resource-instance policy. Neither exposes a second public authorization entry point, and neither can bypass the DSH sandbox. OP may expand actions through Permissions, but does not imply access to every resource.

## Main-agent removal and migration work

The main refactor owner will make these changes after the optional-plugin owners accept their handoffs:

1. Replace the current action-only `FleetAccessService` with `FleetAuthorizationService`, including the shared subject/action/resource types, namespaced action and resource-kind registration, static baseline, `authorize()`, and throwing `require()`.
2. Replace `FleetWorkspaceMount[]` in the base member model with one primary workspace plus the effective native sandbox mode.
3. Remove runtime multi-workspace assignment and its management state/tooling from the base. Preserve only primary-workspace creation and truthful runtime projection.
4. Replace hard-coded `plan/checklist` shared-file behavior with generic real-file operations rooted at `<projectRoot>/.fleet/<teamId>/`.
5. Move private Team records, journals, revisions, extension state, and import staging out of project `.fleet/` directories into Fleet/DSH-owned storage.
6. Remove the event-backed Documents implementation from `@dsh-agent-fleet/resources` and the base collaboration/run projection.
7. Remove Scheduler, project Tasks, and Calendar runtime/tool/projection code from the base.
8. Keep Message/Channel/Direct/Meeting behavior, basic resources, work claims, lifecycle, archives, and extension-state/archive registries.
9. Route tool exposure and every retained business mutation through the unified authorization service; do not leave direct permission-array checks as competing final decisions.
10. Keep Git optional and remove base behavior that assumes the Git plugin exists.
11. Make base UI sections appear only for registered actions/resources actually backed by an installed provider; keep its Team, message, member, shared-file, activity, and control views.
12. Update tests so the no-enhancer configuration proves the complete minimum runtime and unknown actions/resources are denied.

Legacy migration is owned by the main refactor. Existing `plan.md` and `checklist.md` Team files and their resource events must remain readable and be migrated into `<projectRoot>/.fleet/<teamId>/` without asking optional-plugin owners to implement dual paths.

Optional-plugin owners should avoid editing `src/run.ts`, `src/collaboration.ts`, and the base resource implementation until the main refactor lands. Prefer new package-local code and narrowly scoped public interfaces.

## Handoff: Permissions plugin

Owner scope: `packages/permissions`.

Deliver:

- Dynamic permission groups, inheritance, direct grants/denies, presets, and OP/DEOP.
- An action-policy provider installed into Core's authorization service.
- Runtime refresh of installed tool groups and effective actions.
- Persistence per Team through extension state and Team archive participation.
- Downstream namespaced actions registered through Core.
- A permission-management tool and optional UI contribution.
- Adapt imports from the unified authorization service.

Do not implement:

- Workspace, file, resource, dataset, or secret grants.
- Resource-instance decisions.
- A second `authorize`, `can`, or role model outside Core.
- Automatic access to all data for OP. OP expands actions only.

Acceptance:

- Removing the plugin restores the member's static base tool groups and permissions unchanged.
- Installing or removing it never changes a DSH Session workspace or sandbox mode.
- A granted action still fails when Core's resource decision rejects the concrete target.

## Handoff: Access plugin

Suggested package: `@dsh-agent-fleet/access`.

Deliver:

- A resource-policy provider installed into Core's authorization service.
- Resource kinds for `workspace`, `file`, `dataset`, `secret`, and `conversation`, registered through Core as their features are implemented.
- Initial access levels `read`, `write`, `use`, and `manage`.
- Multiple attached workspaces/resources per member as an enhancement over the base primary workspace.
- Access grant/revoke/list operations, persistence through extension state, and archive participation.
- A `fleet_access` management tool guarded by a namespaced management action.
- A UI/keycard contribution showing effective resource access.
- Resource-instance policy decisions consumed only by Core's `authorize()` result.

Constraints:

- Native `bash`, filesystem, and terminal operations remain bounded by DSH's single immutable Session `cwd`.
- Attached roots outside that boundary are accessed only through a provider's bounded Fleet operation; Access must not claim that they are native mounts.
- Changing the primary workspace requires the member to pause and be reprovisioned with a new Session/cwd. Do not mutate an active Session header.
- `use` for future secrets means opaque consumption, not disclosure of secret bytes.
- An Access policy may narrow access and authorize provider-mediated resources; it cannot widen ordinary native filesystem execution beyond DSH.
- Access must not implement permission groups, OP, action grants, or a second role system.

Acceptance:

- With the plugin absent, base single-workspace and shared-directory behavior remains safe and usable.
- A member with every tool Permission but no matching resource Access cannot read/use that managed resource.

## Handoff: Documents plugin

Suggested package: `@dsh-agent-fleet/documents`.

Deliver:

- Document create/read/update/search/version/comment/reply/resolve/revert behavior removed from the base resources package.
- Document contents as real files under the Team shared directory; do not restore event-backed content as the primary copy.
- Plugin-owned metadata for versions and comments, persisted through extension state/archive hooks.
- Namespaced action and resource-kind registration through Core for document operations.
- Optional UI document renderer/history/comments contribution.

Acceptance:

- A document remains a normal readable Team file when the Documents plugin is removed.
- Reinstalling the plugin restores its metadata without replacing the file as the content source of truth.

## Handoff: Tasks, Calendar, and Schedule plugins

These may be separate packages or one initial productivity package, but none is a base dependency.

Deliver the behavior currently embedded in base Core/Run:

- Project task board, assignment, comments, progress, completion/reopen, due notifications.
- Calendar events, RSVP, start/close/cancel, and meeting linking.
- Scheduled task creation, trigger, delivery, completion, and deferred-delivery recovery.
- Plugin-owned persistence, archive participation, tools, projection, and UI contributions.
- Namespaced actions and resource kinds registered through Core.

Acceptance:

- Removing these plugins leaves Team lifecycle, messaging, meetings, shared files, and member status operational.
- Plugins do not require a central coordinator Agent.

## Handoff: Git plugin adaptation

Owner scope: `packages/git`.

Deliver after the base and Access interfaces settle:

- Continue owning repository inspection, scope checks, Worktree creation/management, and branch binding.
- Use the base primary workspace when Access is absent.
- Use Access workspace grants when Access is installed, without treating them as a replacement for the DSH sandbox.
- Register all Git actions and repository/worktree resource kinds through Core authorization; no Git permission remains hard-coded as base business behavior.
- Preserve independent archive state where required.

## Handoff: UI integration

The base UI keeps Team selection, conversations/meetings, members, the generic shared-directory browser, activity, lifecycle controls, setup, and runtime visibility.

Optional plugins contribute their own panels/editors through existing slots:

- Permissions: roles, grants/denies, OP.
- Access: keycard, workspace/resource/secret grants.
- Documents: versions and comments.
- Tasks/Calendar/Schedule: their productivity views.
- Git: repository and Worktree views.

The base UI must not render nonfunctional placeholders for absent plugins.

## Shared acceptance test

Start a Team with only `dsh-agent-fleet` installed. Two members using their native Session workspaces must be able to exchange messages, hold a meeting, create authorized arbitrary files in the Team resource directory through bounded Fleet operations, reference those files in messages, claim work paths, pause, restart, resume, and export/import the Team archive. The same run must deny an unknown action, an unknown resource kind, and a known action against a resource outside the static baseline. No optional plugin may be required for that test.
