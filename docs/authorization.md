# Agent Fleet Authorization

Built-in authorization management for `dsh-agent-fleet`. Simple Team configurations use their member defaults directly; advanced policies add groups, explicit action rules, and resource keycards without installing another plugin.

The root plugin loads three deliberately separate modules:

- **Groups** owns shared groups, inheritance, and member membership. Every member also has an implicit private group such as `member:alice`, following the Unix primary/supplementary-group model.
- **Permissions** assigns actions, Tool Groups, denies, and OP to groups through `fleet_permission`. A member-specific assignment is stored on that member's private group.
- **Access** assigns Team-scoped resource keycards to the same groups through `fleet_access`, with inherit/restricted modes, allow/deny rules, and self/tree scopes.

All modules feed Fleet Core's single `fleetAuthorization.authorize(...)` decision path. Rules from a member's private and supplementary groups are combined, with explicit deny taking precedence. An Access grant cannot restore an action denied by Permissions, and OP grants actions without bypassing resource access, the DSH sandbox, or an external platform's ACL.

Groups, permission assignments, and access keycards are stored independently under the versioned `authorization-groups`, `authorization-permissions`, and `authorization-access` Team extension states. A Team configuration may also seed Access through `dsh-agent-fleet/authorization/access`; the runtime uses that initialization value until the first live edit writes extension state. Feature plugins register their own action namespaces and resource adapters.

Team initialization and the live member panel present Permission and Access together. The default **Simple** view explains common responsibility levels and resource categories in product language. **Detailed** exposes permission groups, individual grants and restrictions, per-resource inherit/restricted modes, and allow/deny exceptions with self/tree scope and read/write/use/manage levels. Shared-group Access rules continue to compose with the private keycard and explicit deny wins.
