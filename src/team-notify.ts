/* ------------------------------------------------------------------ */
/*  notifyMembers — system notification broadcast                      */
/*                                                                     */
/*  Extracted from FleetCollaborationService.open() — the               */
/*  notifyMembers helper that broadcasts FleetSystemNotification to     */
/*  a list of team members via the MessageHub.                         */
/*                                                                     */
/*  Follows the same dependency-injection factory pattern as            */
/*  createTaskSync and CoordinationEventBridge.                        */
/* ------------------------------------------------------------------ */

import type { AgentDirectory } from '@dsh-agent-fleet/message'
import type { FleetSystemNotificationKind, MessageHub } from '@dsh-agent-fleet/message'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NotifyDependencies {
  readonly messages: MessageHub
  readonly agentDirectory: AgentDirectory
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a `notifyMembers` function that broadcasts a system notification
 * to each of the given members via `messages.sendSystemNotification`.
 *
 * Silent on missing agents — members without a live agent are skipped.
 * Deduplicates through `new Set(members)`.
 */
export function createNotifyMembers(deps: NotifyDependencies) {
  return function notifyMembers(
    members: readonly string[],
    text: string,
    kind: FleetSystemNotificationKind,
    coalesceKey: string,
    delivery: 'quiet' | 'wakeup' = 'quiet',
  ): string[] {
    const delivered: string[] = []
    for (const member of new Set(members)) {
      if (deps.agentDirectory.get(member) === undefined) continue
      try {
        deps.messages.sendSystemNotification(member, { kind, text, delivery, coalesceKey })
        delivered.push(member)
      } catch { /* skip member that rejected the notification */ }
    }
    return delivered
  }
}