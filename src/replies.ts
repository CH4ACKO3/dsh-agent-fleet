import type { FleetMessage, MessageAgent, MessageHub } from '@dsh-agent-fleet/message'
import type { FleetProjectTask, FleetTaskBoard } from './productivity/task.js'

/** One reply protocol for tools, native output, and recovery. Messages are the
 * durable receipts; the Task board is their idempotent obligation projection. */
export class FleetReplies {
  constructor(
    private readonly messages: MessageHub,
    private readonly tasks: FleetTaskBoard,
    private readonly resolveMember: (reference: string) => string,
  ) {}

  resolve(callerId: string, id?: string): FleetProjectTask {
    const pending = this.tasks.ownerTasks(callerId).filter(task => task.domain.kind === 'reply')
    if (id === undefined) {
      if (pending.length !== 1) throw new Error(pending.length === 0
        ? 'No owned Reply Task is pending; use fleet_send for a new or optional message'
        : `Multiple Reply Tasks are pending; choose one of: ${pending.map(task => task.id).join(', ')}`)
      return pending[0]!
    }
    // An explicit reference is never replaced with a different obligation.
    const task = this.tasks.get(callerId, id)
    const owner = this.tasks.ownerTasks(callerId).some(candidate => candidate.id === id)
    const participant = this.resolveMember(callerId)
    if (task.domain.kind !== 'reply' || task.domain.assignee !== participant
      || (!owner && task.domain.completionMessageId === undefined)) {
      throw new Error(`Fleet Reply Task ${id} is not owned by the calling member`)
    }
    return task
  }

  answer(agent: MessageAgent, input: { id?: string; content: string; resources?: readonly string[] }) {
    const task = this.resolve(String(agent.id), input.id)
    if (task.domain.kind !== 'reply') throw new Error('Expected Reply Task')
    if (task.domain.completionMessageId !== undefined) return {
      task, messageId: task.domain.completionMessageId, sourceMessageId: task.domain.messageId, replayed: true,
    }
    const result = this.answerMessage(agent, task.domain.messageId, input.content, input.resources)
    return { ...result, task: this.tasks.recordReply(String(agent.id), task.id, result.messageId) }
  }

  answerMessage(agent: MessageAgent, sourceId: string, content: string, resources?: readonly string[]) {
    const source = this.messages.getMessage(agent, sourceId)
    const participant = this.resolveMember(String(agent.id))
    const existing = this.messages.messageHistory().find(message =>
      message.from === participant && message.replyTo === source.id)
    const messageId = existing?.id ?? this.messages.reply(agent, {
      messageId: source.id, text: content,
      ...(resources === undefined ? {} : { resources }),
    }).messageId
    this.messages.completeRequiredReply(String(agent.id), source.id)
    return { messageId, sourceMessageId: source.id, replayed: existing !== undefined }
  }

  projectInteractionOutput(task: FleetProjectTask): void {
    if (task.domain.kind !== 'interaction' || task.domain.settledRevision !== task.domain.inputRevision) return
    const domain = task.domain
    const output = task.entries.findLast(entry => entry.author === domain.owner
      && entry.interactionRevision === domain.settledRevision)
    if (output !== undefined) this.messages.commitExternalOutput(domain.owner, domain.latestMessageId, output.text)
  }

  projectReceipt(message: FleetMessage): void {
    if (message.replyTo === undefined) return
    for (const task of this.tasks.state().tasks) {
      if (task.domain.kind !== 'reply' || task.domain.messageId !== message.replyTo
        || task.domain.assignee !== message.from || task.domain.completionMessageId !== undefined
        || task.stableState.kind === 'cancelled') continue
      this.tasks.recordReplyReceipt(message.from, task.id, message.id)
    }
  }
}
