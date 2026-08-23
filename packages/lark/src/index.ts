import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLarkChannel } from '@larksuite/channel'
import type {} from '@ch4acko3/dsh-agent-fleet-gateway'
import { FleetLarkBotConnector, larkBotConnectorId } from './bot.js'
import { FleetLarkCli, type FleetLarkCliConfig } from './user-cli.js'

export * from './bot.js'
export * from './user-cli.js'

export const name = '@ch4acko3/dsh-agent-fleet-lark'
export const inject = ['fleetGateway']

export interface FleetLarkBotConfig {
  readonly appId?: string
  readonly appSecretRef?: string
  readonly accountId?: string
  readonly domain?: 'feishu' | 'lark'
  readonly requireMention?: boolean
  readonly dmMode?: 'open' | 'allowlist' | 'pair' | 'disabled'
  readonly dmAllowlist?: readonly string[]
  readonly groupAllowlist?: readonly string[]
}

export interface Config {
  readonly bot?: FleetLarkBotConfig
  readonly cli?: FleetLarkCliConfig
}

export class FleetLarkService {
  readonly bot: FleetLarkCli
  readonly user: FleetLarkCli

  constructor(cli: FleetLarkCliConfig = {}) {
    this.bot = new FleetLarkCli('bot', cli)
    this.user = new FleetLarkCli('user', cli)
  }

  botConnectorId(accountId = 'default'): string {
    return larkBotConnectorId(accountId)
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const service = new FleetLarkService(config.cli)
  ctx.provide('fleetLark', service)

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
        dmMode: bot.dmMode ?? 'open',
        ...(bot.dmAllowlist === undefined ? {} : { dmAllowlist: [...bot.dmAllowlist] }),
        ...(bot.groupAllowlist === undefined ? {} : { groupAllowlist: [...bot.groupAllowlist] }),
      },
      outbound: {
        retry: { maxAttempts: 3, baseDelayMs: 500 },
      },
    })
    const connector = new FleetLarkBotConnector(channel, accountId, scope.logger)
    return scope.fleetGateway.register(connector)
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetLark: FleetLarkService
  }
}
