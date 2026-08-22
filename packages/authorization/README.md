# Agent Fleet Authorization

Optional authorization management for `dsh-agent-fleet`. Fleet continues to work without this package by using static member actions, Team membership, workspace boundaries, and each feature plugin's safe defaults.

The package contains three deliberately separate modules behind one installation:

- **Groups** owns shared groups, inheritance, and member membership. Every member also has an implicit private group such as `member:alice`, following the Unix primary/supplementary-group model.
- **Permissions** assigns actions, Tool Groups, denies, and OP to groups through `fleet_permission`. A member-specific assignment is stored on that member's private group.
- **Access** assigns Team-scoped resource keycards to the same groups through `fleet_access`, with inherit/restricted modes, allow/deny rules, and self/tree scopes.

All modules feed Fleet Core's single `fleetAuthorization.authorize(...)` decision path. Rules from a member's private and supplementary groups are combined, with explicit deny taking precedence. An Access grant cannot restore an action denied by Permissions, and OP grants actions without bypassing resource access, the DSH sandbox, or an external platform's ACL.

Groups, permission assignments, and access keycards are stored independently under the versioned `authorization-groups`, `authorization-permissions`, and `authorization-access` Team extension states. Feature plugins register their own action namespaces and resource adapters; Git repositories, external chats, datasets, and secrets are not hard-coded here.
