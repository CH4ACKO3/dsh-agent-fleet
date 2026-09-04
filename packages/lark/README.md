# Agent Fleet Lark

Lark and Feishu integration for Agent Fleet. It exposes two deliberately separate identities:

- A bot connector backed by `@larksuite/channel`, registered with Fleet Gateway for long-running inbound and outbound messaging.
- Identity-pinned `lark-cli` adapters at `ctx.fleetLark.user` and `ctx.fleetLark.bot`. Every business command is spawned directly with an explicit `--as user` or `--as bot`; Fleet never silently switches identity.

Set `LARK_APP_ID` and store the App Secret under the DSH credential reference `LARK_APP_SECRET` to activate the realtime bot connector. Both CLI identities use the existing `lark-cli` profile and remain idle until DSH calls them. `LARK_CLI_PATH` and `LARK_CLI_PROFILE` optionally select a binary and profile.

The package performs transport and identity adaptation only. Fleet Mailbox owns persistence and Team routing; DSH decides which identity and capability to expose.

Set `LARK_USER_OPEN_ID` to make the realtime Bot a private user-Mailbox entrance. `FLEET_LARK_TEAM_ID` selects the Team when several Teams are active, and `FLEET_LARK_ASSISTANT_ID` selects one of several attached assistants. Only direct messages from that user are delivered; Agent Lark permissions are not involved.

Fleet registers `lark.read`, `lark.message-post`, `lark.content-write`, `lark.manage`, and `lark.act-as-user` plus the `lark-resource` resource kind. Trusted DSH adapters call `ctx.fleetLark.executeForAgent(...)` with an Agent id, classified action, and canonical resource. User-identity calls require both the business action and `lark.act-as-user`; raw CLI adapters remain Host-only.
