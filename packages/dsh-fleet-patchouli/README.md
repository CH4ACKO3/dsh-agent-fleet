# dsh-agent-fleet-patchouli

Optional Patchouli integration for Agent Fleet. The package has two modules:

- `dsh-agent-fleet-patchouli/adapter` mounts on Fleet and routes runtime events into Patchouli.
- `dsh-agent-fleet-patchouli/processor` registers directly with Patchouli Core as a third-party processor and fans matching calls out to independently registered algorithm blocks. No ranking or automatic algorithm-selection policy is imposed yet.
- `fleet-conversation-history` searches the stable Fleet message log visible to the calling participant. Shared conversations do not depend on which native Session happened to receive or send a relay.
- `fleet-team-state` and `fleet-team-activity` expose current Team state and bounded durable activity history.
- `fleet-shared-resources` searches Team resource metadata at low effort and bounded textual content at higher effort.

On the first model step of a turn, Fleet task, direct-message, and addressed Channel inputs participate in Patchouli's passive recall path. The adapter derives a bounded query from the newest relevant Fleet or human message, while ignoring Tool results, runtime snapshots, and reminders so passive recall does not repeat on every Tool step.

Generic Session history, repair history, workspace, project, artifact, and Git retrieval are provided by `dsh-patchouli-native-context-service`. This package keeps only Team-owned data and semantics.

Fleet-originated memory metadata uses `fleetEffort` with `low`, `medium`, or `high`. Trusted integrations may set `meta.attributes.fleetEffort`; Patchouli 0.1.3 model tools may request it with `memory_retrieve({ query, metadata: { fleetEffort } })`. The routed attribute takes precedence over tool metadata. Each Fleet algorithm declares its minimum effort, while the selected algorithm receives the same budget for its own depth decisions. Fleet retrievals with missing or invalid effort default to `medium`; explicit `low` and `high` remain available. Conversation history remains one stable Fleet log at every effort level.

The package does not duplicate Fleet journals or Patchouli storage. A routed Fleet event is acknowledged as stored when the durable Fleet journal has made it addressable through the read-through memory algorithms; installed Patchouli providers may also index their own representations.
Patchouli's Agent Loop package remains the sole owner of the standard `memory_update` and `memory_retrieve` tools. Successful public Team and Channel memory writes and effective history recalls are mirrored into Fleet's durable activity timeline.
Timeline activity requires a positive processor result: updates report `handled: true` with `stored > 0`, while retrievals must contain at least one returned item. Routing attempts, skipped updates, zero-write deduplication, empty retrievals, and failures stay out of the timeline.
When the Fleet Web UI is present, the package adds a Team Memory panel for browsing those effective writes and recalls, while the regular Team timeline marks them as dedicated memory entries.
