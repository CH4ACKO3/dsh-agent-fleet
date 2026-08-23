import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-agent-fleet'

export const name = '@ch4acko3/dsh-agent-fleet-gateway'

export interface FleetGatewayInbound {
  readonly connector: string
  readonly payload: unknown
}

export interface FleetGatewayOutbound {
  readonly connector: string
  readonly payload: unknown
}

/** Narrow temporary boundary implemented by Fleet Mailbox. */
export interface FleetGatewayMailbox {
  receive(message: FleetGatewayInbound, signal: AbortSignal): Promise<void>
  onOutbound(listener: (message: FleetGatewayOutbound) => Promise<void>): () => void
}

export interface FleetGatewayConnectorContext {
  deliver(payload: unknown, signal?: AbortSignal): Promise<void>
}

export interface FleetGatewayConnector {
  readonly id: string
  start(context: FleetGatewayConnectorContext): (() => void | Promise<void>) | void
  send(payload: unknown, signal: AbortSignal): Promise<void>
}

interface RegisteredConnector {
  readonly connector: FleetGatewayConnector
  readonly stop?: () => void | Promise<void>
}

const CONNECTOR_ID = /^[a-z][a-z0-9-]*$/u

export class FleetGatewayService {
  private readonly connectors = new Map<string, RegisteredConnector>()
  private readonly controller = new AbortController()
  private mailbox: FleetGatewayMailbox | undefined
  private stopOutbound: (() => void) | undefined
  private closed = false

  bindMailbox(mailbox: FleetGatewayMailbox): () => void {
    if (this.closed) throw new Error('Fleet Gateway is closed')
    if (this.mailbox !== undefined) throw new Error('Fleet Gateway Mailbox is already bound')
    this.mailbox = mailbox
    this.stopOutbound = mailbox.onOutbound(message => this.send(message))
    return () => {
      if (this.mailbox !== mailbox) return
      this.stopOutbound?.()
      this.stopOutbound = undefined
      this.mailbox = undefined
    }
  }

  register(connector: FleetGatewayConnector): () => Promise<void> {
    if (this.closed) throw new Error('Fleet Gateway is closed')
    if (!CONNECTOR_ID.test(connector.id)) throw new Error('Fleet Gateway connector id must use lower-kebab-case')
    if (this.connectors.has(connector.id)) throw new Error(`Fleet Gateway connector ${connector.id} is already registered`)

    const entry: RegisteredConnector = { connector }
    this.connectors.set(connector.id, entry)
    try {
      const stop = connector.start({
        deliver: (payload, signal) => this.receive(connector.id, payload, signal),
      })
      this.connectors.set(connector.id, { connector, ...(stop === undefined ? {} : { stop }) })
    } catch (error) {
      this.connectors.delete(connector.id)
      throw error
    }

    return async () => {
      const current = this.connectors.get(connector.id)
      if (current?.connector !== connector) return
      this.connectors.delete(connector.id)
      await current.stop?.()
    }
  }

  list(): FleetGatewayConnector[] {
    return [...this.connectors.values()].map(entry => entry.connector)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    this.stopOutbound?.()
    this.stopOutbound = undefined
    this.mailbox = undefined
    const entries = [...this.connectors.values()].reverse()
    this.connectors.clear()
    await Promise.allSettled(entries.map(entry => entry.stop?.()))
  }

  private receive(connector: string, payload: unknown, signal?: AbortSignal): Promise<void> {
    if (this.closed || !this.connectors.has(connector)) {
      return Promise.reject(new Error(`Fleet Gateway connector ${connector} is not active`))
    }
    if (this.mailbox === undefined) return Promise.reject(new Error('Fleet Gateway Mailbox is not connected'))
    const deliverySignal = signal === undefined
      ? this.controller.signal
      : AbortSignal.any([signal, this.controller.signal])
    return this.mailbox.receive({ connector, payload }, deliverySignal)
  }

  private send(message: FleetGatewayOutbound): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Fleet Gateway is closed'))
    const connector = this.connectors.get(message.connector)?.connector
    if (connector === undefined) {
      return Promise.reject(new Error(`Fleet Gateway connector ${message.connector} is not registered`))
    }
    return connector.send(message.payload, this.controller.signal)
  }
}

export function apply(ctx: Context): void {
  const gateway = new FleetGatewayService()
  ctx.provide('fleetGateway', gateway)
  ctx.inject(['fleetMailbox'], scope => gateway.bindMailbox(scope.fleetMailbox))
  ctx.effect(() => () => gateway.close(), 'fleetGateway.close()')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetGateway: FleetGatewayService
    fleetMailbox: FleetGatewayMailbox
  }
}
