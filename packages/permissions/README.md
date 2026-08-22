# Agent Fleet Permissions

Optional dynamic action groups for `dsh-agent-fleet`. Without this package, Fleet keeps each member's static tool groups and actions.

The package supplies preset groups, custom group inheritance, direct grants and denies, and OP/DEOP. It recognizes matching native Fleet profiles for display while leaving an unconfigured member on the Core baseline. Changes are persisted per Team and refresh affected member tools without restarting the Team.

The built-in Agent-oriented groups are `Observer`, `Collaborator`, `Researcher`, `Facilitator`, `Maintainer`, and `OP`. They contain only Fleet's own actions; feature plugins contribute their actions dynamically instead of being hard-coded into generic presets.

Feature plugins can register an action namespace through `ctx.fleetAuthorization.registerNamespace(...)`; their action ids then participate in direct grants and OP expansion. This plugin does not decide access to concrete workspaces, files, conversations, datasets, secrets, or repositories.
