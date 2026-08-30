# Durable Task liveness

Fleet keeps long-running work alive through durable Task execution state, not by
keeping an Agent turn running. A Team has no global concurrency limit: every
runnable Task may dispatch independently. A single Task has at most one valid
execution attempt at a time.

## Invariant

Every non-terminal Task has exactly one durable execution state:

- `ready`: a Team member can claim the next attempt now;
- `running`: one named member owns the current attempt;
- `waiting_time`: a persisted timer will make the Task ready;
- `waiting_event`: a named durable event or its timeout will make the Task ready;
- `waiting_vote`: a Fleet Vote or its timeout decides the requested transition;
- `blocked`: the Task explicitly requires outside intervention.

`completed` and `cancelled` are terminal. There is no `active + no continuation`
state.

## One-turn handoff

Dispatch claims `ready` before waking an Agent, producing a unique `attemptId`.
The Agent settles that attempt exactly once. Settlement records progress and the
next execution state in the same Task update, then invalidates the old attempt.
Late settlement with an old `attemptId` is rejected.

External event receipts are stored on the Task by event key. If an operation
finishes before the Agent settles into `waiting_event`, settlement observes the
already-persisted receipt and moves directly to `ready`; it cannot lose the
completion between starting the operation and installing the wait.

Legal settlements are:

- continue immediately (`ready`);
- resume at a time (`waiting_time`);
- resume on an event (`waiting_event`);
- request a completion or blocked Vote (`waiting_vote`);
- block explicitly;
- complete or cancel.

If a model turn ends while its attempt is still `running`, the host first
returns it to `ready` with a reconciliation reason. If the process disappears,
the running timeout performs the same transition. Thus the old attempt is never
removed before a successor state exists.

## Timeouts

Tasks may configure independent ready, running, and event timeout durations.
Timeouts do not complete work. They atomically move the Task to `ready` with the
timed-out state in its reason and mark the continuation as reconciliation. A
normal ready Task is claimable only by its assignees; a reconciliation attempt
is claimable by any available member, so a stuck original assignee cannot block
the fallback.
Timers are restored from persisted state after restart.

## Collaborative decisions

A Task may require a Vote for completion. The executing member settles its
attempt by requesting a Vote. Fleet first persists `waiting_vote` with a
deterministic Vote id, then idempotently opens the Vote and wakes its voters.

- approval completes the Task (or authorizes the final required-message reply);
- rejection returns the Task to `ready` with the rejection reason;
- timeout returns the Task to `ready` for reconciliation.

The Vote is the continuation event, so the initiating Agent may sleep while the
other members decide.
