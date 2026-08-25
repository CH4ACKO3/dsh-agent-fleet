# dsh-fleet-patchouli

Optional Patchouli integration for Agent Fleet. The package has two modules:

- `dsh-fleet-patchouli/adapter` mounts on Fleet and routes runtime events into Patchouli.
- `dsh-fleet-patchouli/processor` registers directly with Patchouli Core as a third-party processor and fans matching calls out to independently registered algorithm blocks. No ranking or automatic algorithm-selection policy is imposed yet.
- `fleet-conversation-history` searches the stable Fleet message log visible to the calling participant. Shared conversations do not depend on which native Session happened to receive or send a relay.
- `fleet-self-history` searches only the calling participant's own model messages and tool history across the native Sessions that have been bound to that stable member or assistant identity. Fleet relays and Fleet send/follow-up calls remain in conversation history instead of being duplicated here.
- `fleet-team-state` and `fleet-team-activity` expose current Team state and bounded durable activity history.
- `fleet-shared-resources` searches Team resource metadata at low effort and bounded textual content at higher effort.
- `fleet-git-context` conditionally uses the read-only Fleet Git service when that optional plugin is present; it requires at least medium effort.

Fleet-originated memory metadata uses `fleetEffort` with `low`, `medium`, or `high`. Trusted integrations may set `meta.attributes.fleetEffort`; Patchouli 0.1.3 model tools may request it with `memory_retrieve({ query, metadata: { fleetEffort } })`. The routed attribute takes precedence over tool metadata. Each Fleet algorithm declares its minimum effort, while the selected algorithm receives the same budget for its own depth decisions. Fleet retrievals with missing or invalid effort default to `medium`; explicit `low` and `high` remain available. Self-history uses only the current hot Session at `low`, includes prior bound and archived Session segments at `medium` and `high`, and raises bounded result/candidate limits with the budget. Conversation history remains one stable Fleet log at every effort level.

The package does not duplicate Fleet journals or Patchouli storage. Installed Patchouli providers decide how events are indexed and retrieved.
Patchouli's Agent Loop package remains the sole owner of the standard `memory_update` and `memory_retrieve` tools. Successful public Team and Channel memory writes and effective history recalls are mirrored into Fleet's durable activity timeline.
Timeline activity requires a positive processor result: updates report `handled: true` with `stored > 0`, while retrievals must contain at least one returned item. Routing attempts, skipped updates, zero-write deduplication, empty retrievals, and failures stay out of the timeline.
When the Fleet Web UI is present, the package adds a Team Memory panel for browsing those effective writes and recalls, while the regular Team timeline marks them as dedicated memory entries.
