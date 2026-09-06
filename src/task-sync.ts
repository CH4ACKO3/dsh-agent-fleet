import type {
  FleetMessage,
  FleetTarget,
} from '@dsh-agent-fleet/message'
import { MessageHub } from '@dsh-agent-fleet/message'
import type { FleetMemberView } from './member-view.js'
import type { FleetTaskBoard } from './productivity/task.js'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TaskSyncDependencies {
  readonly messages: MessageHub
  readonly tasks: FleetTaskBoard
  readonly memberViews: ReadonlyMap<string, FleetMemberView>
  readonly memberNamesById: ReadonlyMap<string, string>

  /**
   * Mutable slot — a placeholder `() => {}` is set at construction time,
   * then replaced with the real `toolManager.ensureFleetTaskTool` once
   * the ToolBindingManager exists.  JavaScript closure captures the
   * mutable property, so `ensureMessageTasks` picks up the real
   * implementation when called.
   */
  ensureFleetTaskTool: (member: string) => void

  /** Resolve a reference string to a Fleet member name. */
  participantName: (reference: string) => string | undefined
}

export interface TaskSyncFunctions {
  readonly hasPendingRequirement: (member: string) => boolean
  readonly ensureMessageTasks: (message: FleetMessage) => string[]
  readonly syncMemberInbox: (member: string) => void
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Extract the message-to-task bridge functions from
 * `FleetCollaborationService.open()`, following the same deps-based
 * factory pattern as `createToolBinding`.
 *
 * These functions flow from MessageHub events into FleetTaskBoard
 * operations: creating Reply Tasks for @-mentions, syncing the unread
 * Inbox state, and deriving required-reply metadata.
 */
export function createTaskSync(deps: TaskSyncDependencies): TaskSyncFunctions {
  const replyTargetFor = (message: FleetMessage): FleetTarget =>
    message.conversation.startsWith('@') ? `@${message.from}` : message.conversation

  const requiredRecipients = (message: FleetMessage): string[] =>
    [...new Set(message.mentions)]

  const requiredTitle = (message: FleetMessage): string =>
    message.origin === 'user'
      ? '对用户输入进行完整回复'
      : '对必答消息进行完整回复'

  const hasPendingRequirement = (member: string): boolean => {
    const task = deps.tasks.pendingReply(member)
    return task !== undefined && task.stableState.kind !== 'cancelled'
  }

  const ensureMessageTasks = (message: FleetMessage): string[] => {
    if (message.kind !== 'text') return []
    const taskIds: string[] = []
    const createdBy = deps.participantName(message.from) ?? message.fromName ?? 'User'
    for (const assignee of requiredRecipients(message)) {
      if (!deps.memberViews.has(assignee)) continue
      // Foreground assistant input is already represented by its durable
      // Interaction Task. A second Reply Task would compete with that user
      // delivery path and encourage fleet_reply to be used on the user.
      if (message.origin === 'user' && deps.tasks.interactionTask(assignee) !== undefined) continue
      const task = deps.tasks.ensureReplyTask({
        messageId: message.id,
        conversation: message.conversationId ?? message.conversation,
        createdBy,
        assignee,
        replyTarget: replyTargetFor(message),
        title: requiredTitle(message),
        description: `Reply obligation for Fleet message ${message.id} in ${message.conversation}. Read the source through fleet_inbox if needed.`,
        resources: message.resources,
      })
      taskIds.push(task.id)
      deps.ensureFleetTaskTool(assignee)
    }
    return taskIds
  }

  const syncMemberInbox = (member: string): void => {
    const summary = deps.messages.taskUnreadSummary(member)
    deps.tasks.syncInbox(member, summary.unreadMessages, summary.unreadChars)
  }

  return {
    hasPendingRequirement,
    ensureMessageTasks,
    syncMemberInbox,
  }
}