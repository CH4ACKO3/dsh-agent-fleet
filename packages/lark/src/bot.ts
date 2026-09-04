import type {
  BotAddedEvent,
  CardActionEvent,
  CommentEvent,
  EventMap,
  LarkChannel,
  NormalizedMessage,
  ReactionEvent,
  SendInput,
  SendOptions,
} from '@larksuite/channel'
import type {
  FleetGatewayConnector,
  FleetGatewayConnectorContext,
  FleetUserMailboxInbound,
  FleetUserMailboxOutbound,
} from 'dsh-agent-fleet'

export type FleetLarkBotInbound =
  | FleetUserMailboxInbound
  | { readonly kind: 'message'; readonly identity: 'bot'; readonly accountId: string; readonly message: NormalizedMessage }
  | { readonly kind: 'card-action'; readonly identity: 'bot'; readonly accountId: string; readonly action: CardActionEvent }
  | { readonly kind: 'reaction'; readonly identity: 'bot'; readonly accountId: string; readonly reaction: ReactionEvent }
  | { readonly kind: 'bot-added'; readonly identity: 'bot'; readonly accountId: string; readonly event: BotAddedEvent }
  | { readonly kind: 'comment'; readonly identity: 'bot'; readonly accountId: string; readonly comment: CommentEvent }

export type FleetLarkBotOutbound =
  | FleetUserMailboxOutbound
  | { readonly kind: 'send'; readonly to: string; readonly input: SendInput; readonly options?: SendOptions }
  | { readonly kind: 'edit'; readonly messageId: string; readonly text: string }
  | { readonly kind: 'recall'; readonly messageId: string }
  | { readonly kind: 'update-card'; readonly messageId: string; readonly card: object }
  | { readonly kind: 'add-reaction'; readonly messageId: string; readonly emojiType: string }
  | { readonly kind: 'remove-reaction'; readonly messageId: string; readonly reactionId: string }
  | { readonly kind: 'remove-reaction-by-emoji'; readonly messageId: string; readonly emojiType: string }

export interface FleetLarkBotLogger {
  info(message: string): void
  warn(message: string): void
}

export interface FleetLarkUserMailboxRoute {
  readonly userOpenId: string
  readonly teamId?: string
  readonly assistantId?: string
}

type ChannelPort = Pick<
  LarkChannel,
  | 'connect'
  | 'disconnect'
  | 'on'
  | 'send'
  | 'editMessage'
  | 'recallMessage'
  | 'updateCard'
  | 'addReaction'
  | 'removeReaction'
  | 'removeReactionByEmoji'
>

export function larkBotConnectorId(accountId = 'default'): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(accountId)) {
    throw new Error('Lark account id must use lower-kebab-case')
  }
  return accountId === 'default' ? 'lark-bot' : `lark-bot-${accountId}`
}

export class FleetLarkBotConnector implements FleetGatewayConnector {
  readonly id: string

  constructor(
    private readonly channel: ChannelPort,
    private readonly accountId: string,
    private readonly logger: FleetLarkBotLogger,
    private readonly userMailbox?: FleetLarkUserMailboxRoute,
  ) {
    this.id = larkBotConnectorId(accountId)
  }

  start(context: FleetGatewayConnectorContext): () => Promise<void> {
    const deliver = (payload: FleetLarkBotInbound): Promise<void> => context.deliver(payload)
    const deliverDetached = (payload: FleetLarkBotInbound): void => {
      void deliver(payload).catch(error => this.logger.warn(`Fleet Lark inbound delivery failed: ${errorText(error)}`))
    }
    const handlers: Partial<EventMap> = {
      message: message => {
        if (this.userMailbox === undefined) {
          return deliver({ kind: 'message', identity: 'bot', accountId: this.accountId, message })
        }
        if (message.chatType !== 'p2p' || message.senderId !== this.userMailbox.userOpenId) return Promise.resolve()
        return deliver({
          kind: 'user-message',
          ...(this.userMailbox.teamId === undefined ? {} : { teamId: this.userMailbox.teamId }),
          ...(this.userMailbox.assistantId === undefined ? {} : { assistantId: this.userMailbox.assistantId }),
          externalUserId: message.senderId,
          conversationId: message.chatId,
          messageId: message.messageId,
          text: message.content,
        })
      },
      ...(this.userMailbox === undefined ? {
        cardAction: (action: CardActionEvent) => deliver({ kind: 'card-action', identity: 'bot', accountId: this.accountId, action }),
        reaction: (reaction: ReactionEvent) => deliverDetached({ kind: 'reaction', identity: 'bot', accountId: this.accountId, reaction }),
        botAdded: (event: BotAddedEvent) => deliverDetached({ kind: 'bot-added', identity: 'bot', accountId: this.accountId, event }),
        comment: (comment: CommentEvent) => deliver({ kind: 'comment', identity: 'bot', accountId: this.accountId, comment }),
      } : {}),
      error: error => this.logger.warn(`Fleet Lark channel error: ${error.message}`),
      reconnecting: () => this.logger.info(`Fleet Lark bot ${this.accountId} reconnecting`),
      reconnected: () => this.logger.info(`Fleet Lark bot ${this.accountId} reconnected`),
    }
    const unsubscribe = this.channel.on(handlers)
    void this.channel.connect().then(
      () => this.logger.info(`Fleet Lark bot ${this.accountId} connected`),
      error => this.logger.warn(`Fleet Lark bot ${this.accountId} failed to connect: ${errorText(error)}`),
    )

    return async () => {
      unsubscribe()
      await this.channel.disconnect()
    }
  }

  async send(payload: unknown, _signal: AbortSignal): Promise<void> {
    const outbound = parseOutbound(payload)
    switch (outbound.kind) {
      case 'user-message':
        await this.channel.send(outbound.conversationId, { markdown: outbound.text })
        return
      case 'send':
        await this.channel.send(outbound.to, outbound.input, outbound.options)
        return
      case 'edit':
        await this.channel.editMessage(outbound.messageId, outbound.text)
        return
      case 'recall':
        await this.channel.recallMessage(outbound.messageId)
        return
      case 'update-card':
        await this.channel.updateCard(outbound.messageId, outbound.card)
        return
      case 'add-reaction':
        await this.channel.addReaction(outbound.messageId, outbound.emojiType)
        return
      case 'remove-reaction':
        await this.channel.removeReaction(outbound.messageId, outbound.reactionId)
        return
      case 'remove-reaction-by-emoji':
        await this.channel.removeReactionByEmoji(outbound.messageId, outbound.emojiType)
    }
  }
}

function parseOutbound(payload: unknown): FleetLarkBotOutbound {
  if (!isRecord(payload) || typeof payload.kind !== 'string') {
    throw new TypeError('Fleet Lark bot outbound payload must be an object with a kind')
  }
  switch (payload.kind) {
    case 'user-message':
      requireString(payload, 'conversationId')
      requireString(payload, 'text')
      return payload as unknown as FleetLarkBotOutbound
    case 'send':
      requireString(payload, 'to')
      if (!isRecord(payload.input)) throw new TypeError('Fleet Lark send input must be an object')
      if (payload.options !== undefined && !isRecord(payload.options)) {
        throw new TypeError('Fleet Lark send options must be an object')
      }
      return payload as FleetLarkBotOutbound
    case 'edit':
      requireString(payload, 'messageId')
      requireString(payload, 'text')
      return payload as FleetLarkBotOutbound
    case 'recall':
      requireString(payload, 'messageId')
      return payload as FleetLarkBotOutbound
    case 'update-card':
      requireString(payload, 'messageId')
      if (!isRecord(payload.card)) throw new TypeError('Fleet Lark card must be an object')
      return payload as FleetLarkBotOutbound
    case 'add-reaction':
    case 'remove-reaction-by-emoji':
      requireString(payload, 'messageId')
      requireString(payload, 'emojiType')
      return payload as FleetLarkBotOutbound
    case 'remove-reaction':
      requireString(payload, 'messageId')
      requireString(payload, 'reactionId')
      return payload as FleetLarkBotOutbound
    default:
      throw new TypeError(`Unknown Fleet Lark bot outbound kind: ${payload.kind}`)
  }
}

function requireString(value: Record<string, unknown>, field: string): void {
  if (typeof value[field] !== 'string' || value[field].length === 0) {
    throw new TypeError(`Fleet Lark outbound ${field} must be a non-empty string`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
