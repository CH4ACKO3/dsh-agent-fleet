# Agent Fleet Permissions

Optional dynamic permission groups for `dsh-agent-fleet`. Without this package, Fleet keeps its fixed member permissions.

The package supplies preset groups, custom group inheritance, direct grants and denies, and OP/DEOP. It recognizes matching native Fleet access profiles as preset groups, while preserving custom fixed profiles exactly. Changes are persisted per Team and refresh affected member tools without restarting the Team.

Feature plugins can register a capability namespace through `ctx.fleetAuthorization.registerNamespace(...)`; their permission ids then participate in the same groups and OP expansion.
