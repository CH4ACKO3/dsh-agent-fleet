# Recursive Task runtime

Fleet models collaboration as a recursive Task tree. Task persistence uses
schema version 6 and intentionally rejects older Task state; this is a breaking
replacement, not a migration layer.

Each Task has a durable stable state and a required reason:

- `running`: domain work, owners, children, or reconcilers are active;
- `dormant`: no member should run now, but a future reconciler or domain event
  can reactivate the Task;
- `blocked`: progress needs intervention;
- `paused`: automatic progression is suppressed;
- `completed`: the domain result is final;
- `cancelled`: the Task was explicitly retired.

Only domain handlers, deterministic timeout fallbacks, and fenced
ReconcileAttempts write stable state. `fleet_task` is read-only; an Agent cannot
manually set a generic Task to completed or blocked.

## Domain Tasks

The public write surface is intentionally higher-level:

- Inbox: every member has one persistent Inbox Task. Unread messages move it
  from `dormant` to `running`; `fleet_inbox read` consumes an aggregate bounded
  batch across visible conversations and the domain reconciles it automatically.
  A complete message already queued in the member's native Session remains
  unread for UI receipts but is excluded from Inbox owner work, so the model is
  never asked to fetch the same body twice.
- Reply: every resolved `@mention` creates one Reply Task per target.
  `fleet_reply` sends the response, records the delivery message id, and
  atomically completes the Task.
- Goal: one or more owners submit `complete` or `block` with a reason through
  `fleet_goal`. `complete` means the owned assignment produced its result; that
  result may still recommend rejecting a parent outcome. `block` is reserved
  for an external condition that prevents the assignment from continuing.
- Vote: each voter casts `approve` or `reject` with a reason through
  `fleet_vote`. A rejection determines the result immediately; unanimous
  approval completes the Vote.
- Interaction: each attached assistant has at most one persistent foreground
  Interaction Task. Direct native user inputs increment its revision instead
  of creating more Tasks. `fleet_user_task continue` links formal-member Tasks
  and makes the Interaction dormant. A system reconciler later stores one
  revision-fenced completion Delivery with the linked outcomes. `report` or
  `block` records a result intent that consumes that Delivery only after a
  non-empty native assistant response is recorded.
- Composite: orchestration Tasks are advanced only by `fleet_reconcile` and can
  recursively own or link child Tasks.

Optional Goal, Vote, and Reply deadlines install a deterministic `$system`
reconciler whose fallback blocks the Task. No model call is needed at timeout.

## Owners and targeted liveness

A Task has zero or more concrete owners. A member's Task list is derived rather
than persisted separately. It contains exactly the `running` Tasks for which
that member still owes its domain operation:

- unread Inbox content;
- an undelivered Reply;
- a missing Goal submission;
- a missing Vote ballot;
- an unsettled foreground Interaction revision owned by an assistant.

A non-empty list wakes only that owner. It never wakes unrelated Team members.
The item disappears as soon as the domain operation is recorded or the Task
leaves `running`. A Task may have no owner when progression is entirely event,
child, time, or reconciler driven.

Automatic continuation is also fenced by Session health. A non-network turn
failure normally pauses owner-list, ready-Task, and idle continuation for that
Session instead of immediately feeding the same work back into a broken model
route. Malformed inference tool protocol is handled separately: Fleet retries
the affected Session twice from durable Task state, then wakes one available
foreground assistant to inspect or reassign the unsettled work. It neither
broadcasts the failure nor leaves the failed owner as an invisible liveness
gap. Other durable Tasks remain `running`; an explicit new turn clears their
health fence. Transient network failures continue through their separate
bounded backoff and route-recovery scheduler.

Any real user message addressed to a Team member updates that recipient's
persistent Inbox and Reply Tasks. If its Session is not loaded, Fleet restores
only that concrete owner; unrelated members with empty Task lists remain
offline. The same targeted loader handles Tasks created by internal Team
activity.

At DSH startup, Fleet first restores each unpaused resident Team assistant and
then preloads that Team's unpaused formal-member Sessions. Preloading restores
Session history, Agent scopes, and tool bindings, but does not inject a wake
notification or start a model turn. Paused Teams and explicitly paused members
remain unloaded. The targeted owner loader remains the fallback for a Session
that is later disposed, unavailable during startup, or added after preload.

A direct foreground input to an attached Team assistant is the one broader
presence boundary: Fleet loads every unpaused formal-member Session before the
assistant handles it. Loading does not broadcast a wake notification or start
a model turn. Task owner lists, ready reconcilers, and explicit directives still
decide which members actually run, so ordinary conversation does not spend one
model call per member.

This makes an iteration or sprint a normal parent Task: open one child Goal per
member, let every owner work independently, and arm the parent reconciler for a
barrier such as all children settled, at least one child completed, or the
review deadline.

## Foreground Interaction liveness

The foreground user conversation is a durable scheduling source, not an
ordinary Fleet message. A direct user input creates or reopens the assistant's
single Interaction Task. Multiple inputs are merged by monotonically
increasing `inputRevision`; a later revision removes any stale continuation or
report intent.

While the assistant is actively deciding what to do, the Interaction is
`running` and therefore appears in only that assistant's owner list. If formal
Team work must continue, the assistant calls `fleet_user_task continue` with
live formal-member Tasks or creates one concrete formal-member Goal. After a
progress Delivery it may omit both to retain the already-linked live Tasks. Fleet
atomically records those links and changes the Interaction to `dormant` with
two deterministic `$system` reconcilers:

- a latched delivery event, fired as soon as all linked Tasks settle or the
  Team becomes quiescent;
- an absolute progress-check time, five minutes by default.

Team quiescence means every formal member is idle and none has a running
attempt, ready attempt, or pending owner Task. It excludes assistants, so the
Interaction itself cannot prevent the condition. Linked completion,
quiescence, or the deadline atomically creates a persistent `pendingDelivery`
containing a delivery id, the input revision, trigger cause, and snapshots of
every linked Task outcome, then returns the Interaction to `running`. The
normal owner-list path injects that structured Delivery and wakes only its
assistant. Unrelated Team work may remain active. The assistant can inspect the
result, atomically consume the Delivery by installing another bounded
continuation, or prepare the user-facing answer.

The linked Task ids remain fenced across that wake-up and across later
`continue` calls. A continuation drops only links that have already settled,
then appends its newly supplied live Tasks or Goal. It cannot replace a live
composite root with one interesting child. If any retained or newly linked
Task is still live, `fleet_user_task report` and `block` are rejected; the
assistant must repair or repeat the bounded continuation. This prevents a
stall deadline or progress check from bypassing an unfinished root outcome.

`fleet_user_task report` and `block` record intent but do not complete an
Interaction without a non-empty native `assistant/message` from the same turn.
The output and intent may arrive in either order; once both exist for the same
input revision Fleet atomically commits `completed` or `blocked` and consumes
the pending Delivery. Interaction state changes do not enter the generic Task
notification channel, because direct user input and the dedicated owner-list
Delivery already provide its scheduling signals. If a turn ends without both
reporting and visible output, or without installing a continuation, the
Interaction remains `running`; its non-empty owner list injects the same
Delivery again.

## ReconcileAttempt and the no-gap invariant

A reconciler contains:

- a trigger expression;
- one exact target member or `$system`;
- priority and retry delay;
- a maximum wake count;
- an optional absolute timeout;
- a deterministic `blocked`, `paused`, or `cancelled` fallback.

Supported trigger leaves are `on_enter`, a latched named event, an absolute
time, and a child-state count. `all` and `any` compose them. For example:

```json
{
  "kind": "any",
  "items": [
    {
      "kind": "child_count",
      "states": ["completed", "blocked"],
      "op": "eq",
      "value": "cohort"
    },
    { "kind": "at", "at": "2026-09-01T09:00:00.000Z" }
  ]
}
```

When a trigger matches, Fleet atomically materializes one ready
ReconcileAttempt for the current Task state version. The scheduler claims it
before sending a `[Fleet task attempt]` notice, which creates a fresh per-turn
`attemptId` fence. The recipient therefore calls `resolve` directly with the
Task id and that exact attempt id; `claim` is only for a ready Task discovered
manually through `list`. Resolution validates the Task version, reconciler id,
target member, and attempt id, then stages children and the next stable state
in one transaction.

The crucial invariant is enforced at commit time:

> A ReconcileAttempt cannot resolve to `running` or `dormant` unless the next
> stable state installs at least one reconciler.

The new state is evaluated for already-true triggers before the old attempt is
retired. Therefore the next ready attempt can be visible in the same atomic
commit. Child creation, linking, cancellation, Vote creation, owner changes,
progress, and the next state are committed together; a stale duplicate attempt
cannot win afterward.

If a member turn ends without resolution, Fleet removes only that turn's fence
and retries the same target after `retryAfterSeconds`. Exhausting `maxWakeups`
or reaching `timeoutAt` atomically applies the configured fallback. This keeps
long work durable without keeping a model process alive or waking the whole
Team.

## Child cohorts

`parentId` defines the recursive lifecycle tree. A running state's `cohort` is
the child membership snapshot observed by its triggers. Children created or
linked during resolution enter the next cohort before it becomes visible, so
an all-children barrier cannot race with late child creation.

Tasks with `decision: "vote"` require an approved Vote child in their current
cohort before a ReconcileAttempt may commit `completed`. A rejected Vote is
itself a successfully completed decision Task; its parent must start a
remediation/acceptance round or choose a real terminal impediment.

## Work and observation

For a decomposed work item, the assistant first attaches an ordered `stages`
plan to its kickoff directive. A stage is either owned Goal work or an explicit
approve/reject Vote, and may depend only on earlier stage keys. `fleet_run
start` atomically creates a zero-owner composite root plus this first cohort and
its concrete dependencies. Only dependency-free Goal owners or Vote voters
enter runnable owner lists.

The root carries no owner, so it consumes no turns while the cohort runs. When
the complete/blocked/cancelled count reaches the cohort size, one designated
coordinator receives a fenced ReconcileAttempt. That attempt must either choose
a terminal state or atomically install another cohort and its trigger. Direct
Goal/Vote creation under a managed work root is rejected; later rounds are
created only through `child_ops`, so a late child cannot open a liveness gap.

If the plan contains an acceptance Vote, the root uses `decision: "vote"`.
A rejection therefore cannot complete the root. The coordinator creates a
remediation Goal, waits for it, creates a fresh Vote, and completes only from a
cohort containing approval. Old attempts remain terminal children instead of
being reopened, which preserves an auditable sequence:

```text
implementation #1 -> review #1 (reject) -> remediation #1
                  -> review #2 (approve) -> root completed
```

Without a staged kickoff, Fleet creates the same composite root with one
default delivery Goal as its first cohort. In both forms, the root's terminal
state deterministically finishes or blocks the outer work record. Ordinary
messages never start work Tasks.

The same continuation round handles ordinary collaboration without a separate
workflow engine:

- sequential handoff: the reconciler replaces A's completed Goal with B's Goal;
- parallel work and merge: one cohort contains A/B/C, then an all/any/count
  trigger opens the aggregation round;
- required response: a Reply Task is linked into the cohort;
- joint judgment: a Vote child records approve/reject while the parent decides
  what that result means;
- external wait: the parent becomes dormant with an event trigger and timeout;
- retry or repair: a new attempt child replaces the old cohort instead of
  reopening terminal history.

Only the current leaf owners, Vote voters, Reply assignees, or one ready
reconciler target are woken. A zero-owner parent waiting on children consumes
no model turns.

`fleet_progress` is deliberately outside Task state. It is a read-only compact
thread-style view of one reachable member's current runtime status and bounded
recent output. Reading it never wakes, interrupts, or changes that member. A
caller waiting on a known cursor can suspend the read until that member's trace
changes instead of polling identical snapshots. Foreground assistants should
normally link Reply/Goal Tasks through their Interaction and let Task settlement
wake them; progress waiting is only an observation fallback.

An unmentioned `fleet_send` Channel post is stored as FYI history. It creates no
recipient Inbox work and wakes nobody. Mentions continue to create targeted
Reply Tasks, while `fleet_reply` addresses only the source participant. When a
member owns exactly one Reply Task, `fleet_reply` binds it automatically if the
id is omitted or stale. A foreground assistant's direct message to one formal
member is a response request by default and therefore creates one Reply Task;
`reply_mode="optional"` explicitly keeps it optional, while an empty mention list cannot
accidentally suppress the default. Direct user input to that
assistant does not create a parallel Reply Task because its Interaction Task is
already the durable delivery path. A formal member's successful `fleet_reply`
ends that turn before redundant private acknowledgement text is generated.
The assistant-scoped `fleet_send` reconciles the Reply Task before returning, so
the first send returns its stable `replyTaskIds`. `fleet_user_task continue` is
idempotent when a requested Reply Task settles before the wait is installed.

Private visibility reminders are queued without waking the Session. The first
model context observed at startup or after compaction establishes the epoch
baseline and cannot trigger a reminder. Subsequent reminder intervals are the
configured growth, then twice that growth, then four times it, and so on within
the compaction epoch; this reduces reminder density as earlier reminders remain
in context.
