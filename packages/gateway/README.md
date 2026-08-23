# Agent Fleet Gateway

External protocol boundary for Fleet. Connectors own authentication, protocol conversion, external identity and destination mapping, rate limits, retry, and external message ID deduplication. Gateway routes their normalized payloads into Fleet Mailbox and forwards Mailbox outbound events to the selected connector.

The current Mailbox boundary intentionally keeps payloads opaque while the unified envelope API is being finalized. Gateway and its connector registry can load before Mailbox; delivery remains disabled until the Mailbox service appears. Gateway does not persist messages, route Team conversations, or write Agent inboxes.
