# Recursive Task reconciliation

Fleet models long-running work as a recursive Task tree. A Task keeps one
durable stable state. Agent work can change that state only by settling its
current ReconcileAttempt. The only operational exception is an explicit
manager cancellation; deterministic engine fallbacks also use atomic state
replacement.

This is a breaking replacement for the old `ready`, `waiting_time`,
`waiting_event`, and `waiting_vote` execution-state model. Persisted Task state
uses schema version 5 only. Version 5 separates persisted owner intent from
Task state and does not migrate older Task state.

## Operations, intentions, and state

Task management operations create a Task, update its metadata, or cancel it.
Cancellation requires `task.manage` and is an explicit lifecycle operation.
Required-message Tasks cannot be cancelled while their external reply
obligation remains. There is no manual reopen or general-purpose stable-state
setter.

The `complete` and `block` Task actions are owner intentions. They record what
one owner believes should happen and never write the Task stable state. The
`settle` action is different: it requires the current ReconcileAttempt fence
and exact target identity, and is the normal path that atomically installs a
next stable state. Task management permission cannot bypass that target fence.

## Stable states

- `running`: the Task owns an immutable cohort of child Task ids for this state
  version and has one or more armed reconcilers;
- `dormant`: no work should run now, but one or more deterministic triggers can
  reopen reconciliation later;
- `blocked`: progress requires intervention that is not currently predictable;
- `paused`: automatic progression is intentionally suppressed;
- `completed` and `cancelled`: terminal states.

`running` describes an active orchestration scope, not a live model call. All
Agents may sleep while a running parent waits for its children.

## Triggers

A reconciler is addressed to one exact member and has a trigger expression.
Supported leaves are:

- state entry (`on_enter`);
- a durable named event;
- an absolute time;
- a count of cohort children in selected stable states;
- a count of owners that marked `complete` or `block` intent.

`all` and `any` compose these leaves recursively. For example, a time-boxed
iteration can reconcile when all children have returned a result or when the
review deadline arrives:

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

Event receipts are latched on their Task. An event that arrives before the
Task enters a matching dormant state is therefore observed immediately after
settlement instead of being lost.

## Owners and member task lists

A Task has zero or more owners. Every owner is one concrete Fleet member,
including a formal Agent or an attached user-facing assistant. Owners are
independent from assignees: an assignee receives an exact ReconcileAttempt,
while an owner independently contributes a completion intent.

An owner starts without an intent. That same member may call Task `complete`
with evidence or Task `block` with a reason. The resulting intent is durable,
but the Task remains in its current stable state. An `owner_intent_count`
trigger can start the next ReconcileAttempt when, for example, every owner has
submitted either intent:

```json
{
  "kind": "owner_intent_count",
  "intents": ["complete", "block"],
  "op": "eq",
  "value": "owners"
}
```

A member's owner task list is derived rather than persisted separately. It
contains exactly the Tasks that are currently in stable state `running` and
have no intent from that member. A non-empty list generates a
targeted continuation for that member whenever they become idle; no unrelated
member is woken. The continuation stops as soon as the owner marks either
intent or the Task leaves `running`.

Owners may be declared when a Task is created. If a ReconcileAttempt is active,
changing the owner set is part of that attempt's atomic settlement; otherwise
an administrative Task update may change it directly. Retained owners keep
their existing intent, while newly added owners start without one.

## ReconcileAttempt lifecycle

When a trigger becomes true, Fleet atomically attaches one ready
ReconcileAttempt to the source Task state version. A Task version can have at
most one active ReconcileAttempt. If several reconcilers match, Fleet selects
the highest priority and then the lexically smallest id.

Claiming an attempt:

1. verifies the exact target member and completed dependencies;
2. reserves that member for this reconciliation;
3. creates a fresh per-turn `attemptId` fence;
4. increments the configured wake count.

Settlement validates the Task version, reconcile id, target member, and current
turn fence. It then commits all of the following as one state update:

- the progress entry;
- child Task creation, linking, cancellation, or Vote creation;
- the next explicit stable state;
- the next cohort and reconciler definitions;
- retirement of the old ReconcileAttempt.

The new stable state is evaluated for already-true triggers before the caller
is released. A non-terminal settlement is invalid unless `running` or
`dormant` includes at least one reconciler.

## Retry and timeout

A ReconcileAttempt configures one target member, a retry delay, a maximum wake
count, an optional absolute timeout, and a deterministic fallback stable state.
If an Agent turn ends without settlement, Fleet keeps the same ReconcileAttempt,
removes the old turn fence, and wakes only that target again. Other members are
not woken.

The member is logically reserved while the attempt is waiting or running, but
no model call is kept alive between retries. Reaching the wake limit or timeout
atomically applies the configured `blocked`, `paused`, or `cancelled` fallback.

The liveness invariant is therefore:

> Every automatically live Task has either an active ReconcileAttempt or an
> armed durable reconciler, while every owner without an intent has a derived
> member task list that targets only that owner. A model process does not need to remain
> online between continuations.

## Recursive children and Votes

`parentId` defines lifecycle ownership as a strict tree. A running state's
`cohort` is the immutable child membership snapshot observed by its triggers.
Adding children requires a new parent state version, so an `all children`
barrier cannot race with late child creation.

Links may include existing Tasks without changing their lifecycle parent.
Creating a child inside settlement assigns the current Task as its parent and
adds it to the new cohort before the settlement is visible.

A collaborative decision is represented as a Vote child Task. The child stays
`dormant` while ballots are open, then a deterministic system reconciler marks
it completed or blocked. That child transition can trigger the parent's next
ReconcileAttempt. A parent whose decision mode is `vote` cannot enter
`completed` or `blocked` until its current cohort contains the corresponding
approved Vote child.
