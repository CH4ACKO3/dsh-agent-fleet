# Agent Fleet Authorization

Optional authorization management for `dsh-agent-fleet`. Fleet continues to work without this package by using static member actions, Team membership, workspace boundaries, and each feature plugin's safe defaults.

The package contains two deliberately separate modules behind one installation:

- **Permissions** decides whether a subject may perform an action. It provides groups, inheritance, direct grants and denies, Tool Groups, and OP/DEOP through `fleet_permission`.
- **Access** decides whether an allowed action may target a concrete resource. It provides Team-scoped keycards, inherit/restricted modes, allow/deny rules, and self/tree scopes through `fleet_access`.

Both modules feed Fleet Core's single `fleetAuthorization.authorize(...)` decision path. An Access grant cannot restore an action denied by Permissions, and OP grants actions without bypassing resource access, the DSH sandbox, or an external platform's ACL.

Existing persisted namespaces remain `permissions` and `access`, and the legacy permissions configuration module id remains accepted. Feature plugins register their own action namespaces and resource adapters; Git repositories, external chats, datasets, and secrets are not hard-coded here.
