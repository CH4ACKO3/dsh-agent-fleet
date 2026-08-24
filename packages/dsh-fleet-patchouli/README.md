# dsh-fleet-patchouli

Optional Patchouli integration for Agent Fleet. The package has two modules:

- `dsh-fleet-patchouli/adapter` mounts on Fleet, routes runtime events into Patchouli, and exposes `fleet_recall`.
- `dsh-fleet-patchouli/processor` registers directly with Patchouli Core as a third-party processor. It currently accepts only Fleet sources; storage and retrieval algorithms are intentionally left for the next design step.

The package does not duplicate Fleet journals or Patchouli storage. Installed Patchouli providers decide how events are indexed and retrieved.
Successful public Team and Channel memory writes and recalls are mirrored into Fleet's durable activity timeline. Direct-message memory stays visible only in the calling member's Session trace.
