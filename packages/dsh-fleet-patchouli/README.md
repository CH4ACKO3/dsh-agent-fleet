# dsh-fleet-patchouli

Optional Patchouli integration for Agent Fleet. The package has two modules:

- `dsh-fleet-patchouli/adapter` mounts on Fleet and routes runtime events into Patchouli.
- `dsh-fleet-patchouli/processor` registers directly with Patchouli Core as a third-party processor and fans matching calls out to independently registered algorithm blocks. No ranking or automatic algorithm-selection policy is imposed yet.
- `fleet-conversation-history` searches only Fleet relay and send records visible in the calling participant's native Session history. It uses the official `ctx.sessionQuery` full-text implementation when enabled, falls back to its official literal event scan when content search is disabled, and follows optional Session Archive segments.
- `fleet-self-history` searches only the calling member's own messages and tool history. Fleet relays and Fleet send/follow-up calls remain in conversation history instead of being duplicated here.
- `fleet-team-state` and `fleet-team-activity` expose current Team state and bounded durable activity history.
- `fleet-shared-resources` searches Team resource metadata at low effort and bounded textual content at higher effort.
- `fleet-git-context` conditionally uses the read-only Fleet Git service when that optional plugin is present; it requires at least medium effort.

Fleet-originated memory metadata uses `fleetEffort` with `low`, `medium`, or `high`. Trusted integrations may set `meta.attributes.fleetEffort`; Patchouli 0.1.3 model tools may request it with `memory_retrieve({ query, metadata: { fleetEffort } })`. The routed attribute takes precedence over tool metadata. Each Fleet algorithm declares its minimum effort, while the selected algorithm receives the same budget for its own depth decisions. Fleet retrievals with missing or invalid effort default to `medium`; explicit `low` and `high` remain available. Conversation and self-history search use only the current hot Session at `low`, include archived Session segments at `medium` and `high`, and raise bounded result/candidate limits with the budget.

The package does not duplicate Fleet journals or Patchouli storage. Installed Patchouli providers decide how events are indexed and retrieved.
Patchouli's Agent Loop package remains the sole owner of the standard `memory_update` and `memory_retrieve` tools. Successful public Team and Channel memory writes and effective history recalls are mirrored into Fleet's durable activity timeline.
Timeline activity requires a positive processor result: updates report `handled: true` with `stored > 0`, while retrievals must contain at least one returned item. Routing attempts, skipped updates, zero-write deduplication, empty retrievals, and failures stay out of the timeline.
When the Fleet Web UI is present, the package adds a Team Memory panel for browsing those effective writes and recalls, while the regular Team timeline marks them as dedicated memory entries.
