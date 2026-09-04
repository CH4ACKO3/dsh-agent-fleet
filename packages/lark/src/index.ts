import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLarkChannel } from '@larksuite/channel'
import type { FleetAuthorizationService } from 'dsh-agent-fleet'
import { FleetLarkBotConnector, larkBotConnectorId } from './bot.js'
import {
  FleetLarkCli,
  type FleetLarkCliConfig,
  type FleetLarkCommandOptions,
  type FleetLarkCommandResult,
  type FleetLarkCliIdentity,
} from './user-cli.js'

export * from './bot.js'
export * from './user-cli.js'

export const name = '@ch4acko3/dsh-agent-fleet-lark'
export const inject = ['fleetGateway', 'fleetAuthorization']

export const FLEET_LARK_PERMISSIONS = [
  { id: 'read', description: 'Read data visible to the selected Lark identity.' },
  { id: 'message-post', description: 'Send or modify Lark messages and reactions.' },
  { id: 'content-write', description: 'Create or modify Lark documents, tasks, calendar entries, and other content.' },
  { id: 'manage', description: 'Manage Lark chats, members, permissions, or application state.' },
  { id: 'act-as-user', description: 'Use the signed-in user identity instead of the application bot.' },
] as const

export type FleetLarkAction = `lark.${typeof FLEET_LARK_PERMISSIONS[number]['id']}`
export type FleetLarkBusinessAction = Exclude<FleetLarkAction, 'lark.act-as-user'>

export interface FleetLarkAuthorizedCommand {
  readonly agentId: string
  readonly identity: FleetLarkCliIdentity
  readonly action: FleetLarkBusinessAction
  /** Canonical resource such as chat:oc_xxx, doc:docx:token, or calendar:id. */
  readonly resource: string
  readonly args: readonly string[]
}

export interface FleetLarkBotConfig {
  readonly appId?: string
  readonly appSecretRef?: string
  readonly accountId?: string
  readonly domain?: 'feishu' | 'lark'
  readonly requireMention?: boolean
  readonly dmMode?: 'open' | 'allowlist' | 'pair' | 'disabled'
  readonly dmAllowlist?: readonly string[]
  readonly groupAllowlist?: readonly string[]
  readonly userMailbox?: {
    readonly userOpenId?: string
    readonly teamId?: string
    readonly assistantId?: string
  }
}

export interface Config {
  readonly bot?: FleetLarkBotConfig
  readonly cli?: FleetLarkCliConfig
}

export class FleetLarkService {
  readonly bot: FleetLarkCli
  readonly user: FleetLarkCli

  constructor(
    cli: FleetLarkCliConfig = {},
    private readonly authorization?: FleetAuthorizationService,
  ) {
    this.bot = new FleetLarkCli('bot', cli)
    this.user = new FleetLarkCli('user', cli)
  }

  botConnectorId(accountId = 'default'): string {
    return larkBotConnectorId(accountId)
  }

  /** Trusted DSH seam for an Agent operation already classified into an action and resource. */
  async executeForAgent(
    input: FleetLarkAuthorizedCommand,
    options: FleetLarkCommandOptions = {},
  ): Promise<FleetLarkCommandResult> {
    if (this.authorization === undefined) throw new Error('Fleet Lark authorization is unavailable')
    if (input.args.some(argument => argument === '--yes' || argument.startsWith('--yes='))) {
      throw new Error('Fleet Agents cannot auto-confirm high-risk lark-cli operations')
    }
    const actor = this.authorization.actorForAgent(input.agentId)
    if (actor === undefined || (actor.subject.kind !== 'member' && actor.subject.kind !== 'assistant')) {
      throw new Error(`Agent ${input.agentId} is not an active Fleet participant`)
    }
    const resource = normalizeLarkResource(input.resource)
    this.authorization.require({
      teamId: actor.teamId,
      subject: actor.subject,
      action: input.action,
      resource: { kind: 'lark-resource', id: resource },
    })
    if (input.identity === 'user') this.authorization.require({
      teamId: actor.teamId,
      subject: actor.subject,
      action: 'lark.act-as-user',
    })
    const cli = input.identity === 'bot' ? this.bot : input.identity === 'user' ? this.user : undefined
    if (cli === undefined) throw new Error(`Unknown Fleet Lark identity: ${String(input.identity)}`)
    return cli.execute(input.args, options)
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  ctx.inject(['fleetAuthorization'], scope => {
    const service = new FleetLarkService(config.cli, scope.fleetAuthorization)
    scope.provide('fleetLark', service)
    const stopNamespace = scope.fleetAuthorization.registerNamespace({
      namespace: 'lark',
      actions: FLEET_LARK_PERMISSIONS,
    })
    const stopResource = scope.fleetAuthorization.registerResourceKind({
      kind: 'lark-resource',
      authorizeBaseline: () => true,
    })
    return () => {
      stopResource()
      stopNamespace()
    }
  })
  ctx.inject(['fleetAccess'], scope => scope.fleetAccess.registerAdapter({
    kind: 'lark-resource',
    levelFor: action => {
      if (action === 'lark.read') return 'read'
      if (action === 'lark.message-post' || action === 'lark.content-write') return 'write'
      if (action === 'lark.manage') return 'manage'
      return undefined
    },
    normalize: (_teamId, resourceId) => normalizeLarkResource(resourceId),
  }))

  const bot = config.bot
  if (bot?.appId === undefined || bot.appId.length === 0) {
    ctx.logger.info('Fleet Lark CLI identities are available; realtime bot is dormant because appId is not configured')
    return
  }

  ctx.inject(['credentials'], async scope => {
    const secretRef = credentialRef(bot.appSecretRef ?? 'LARK_APP_SECRET')
    const secret = await scope.credentials.resolve(secretRef)
    if (secret === undefined) {
      scope.logger.info(`Fleet Lark bot is dormant because ${String(secretRef)} is not configured`)
      return
    }

    const accountId = bot.accountId ?? 'default'
    const userMailbox = normalizeUserMailbox(bot.userMailbox)
    const channel = createLarkChannel({
      appId: bot.appId!,
      appSecret: secret.value,
      domain: bot.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
      source: 'dsh-agent-fleet-lark',
      respectProxyEnv: true,
      handshakeTimeoutMs: 30_000,
      httpTimeoutMs: 30_000,
      includeRawEvent: false,
      resolveSenderNames: true,
      safety: {
        batch: {
          text: { delayMs: 0 },
          media: { delayMs: 0 },
        },
      },
      policy: {
        requireMention: bot.requireMention ?? true,
        dmMode: userMailbox === undefined ? bot.dmMode ?? 'open' : 'allowlist',
        ...(userMailbox === undefined
          ? (bot.dmAllowlist === undefined ? {} : { dmAllowlist: [...bot.dmAllowlist] })
          : { dmAllowlist: [userMailbox.userOpenId] }),
        ...(bot.groupAllowlist === undefined ? {} : { groupAllowlist: [...bot.groupAllowlist] }),
      },
      outbound: {
        retry: { maxAttempts: 3, baseDelayMs: 500 },
      },
    })
    const connector = new FleetLarkBotConnector(channel, accountId, scope.logger, userMailbox)
    return scope.fleetGateway.register(connector)
  })
}

function normalizeUserMailbox(value: FleetLarkBotConfig['userMailbox']): {
  readonly userOpenId: string
  readonly teamId?: string
  readonly assistantId?: string
} | undefined {
  const userOpenId = value?.userOpenId?.trim()
  if (userOpenId === undefined || userOpenId.length === 0) return undefined
  if (!/^ou_[A-Za-z0-9_-]+$/u.test(userOpenId)) {
    throw new Error('Fleet Lark user Mailbox userOpenId must be a Feishu/Lark open_id')
  }
  const teamId = value?.teamId?.trim()
  const assistantId = value?.assistantId?.trim()
  return {
    userOpenId,
    ...(teamId === undefined || teamId.length === 0 ? {} : { teamId }),
    ...(assistantId === undefined || assistantId.length === 0 ? {} : { assistantId }),
  }
}

function normalizeLarkResource(value: string): string {
  const resource = value.trim()
  if (!/^[a-z][a-z0-9-]*:.+$/u.test(resource)) {
    throw new Error('Fleet Lark resource must use kind:identifier form')
  }
  return resource
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetLark: FleetLarkService
  }
}
