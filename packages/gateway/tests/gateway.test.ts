import { describe, expect, it, vi } from 'vitest'

import {
  FleetGatewayService,
  type FleetGatewayConnectorContext,
  type FleetGatewayMailbox,
  type FleetGatewayOutbound,
} from '../src/index.js'

function fixture() {
  const receive = vi.fn<FleetGatewayMailbox['receive']>().mockResolvedValue(undefined)
  let outbound: ((message: FleetGatewayOutbound) => Promise<void>) | undefined
  const mailbox: FleetGatewayMailbox = {
    receive,
    onOutbound: listener => {
      outbound = listener
      return () => { outbound = undefined }
    },
  }
  const gateway = new FleetGatewayService()
  gateway.bindMailbox(mailbox)
  return { gateway, receive, outbound: () => outbound }
}

describe('FleetGatewayService', () => {
  it('routes connector input into Mailbox and Mailbox output back to the connector', async () => {
    const { gateway, receive, outbound } = fixture()
    let context: FleetGatewayConnectorContext | undefined
    const send = vi.fn().mockResolvedValue(undefined)
    const unregister = gateway.register({
      id: 'webhook',
      start: value => { context = value },
      send,
    })

    await context?.deliver({ text: 'inbound' })
    expect(receive).toHaveBeenCalledWith(
      { connector: 'webhook', payload: { text: 'inbound' } },
      expect.any(AbortSignal),
    )
    await outbound()?.({ connector: 'webhook', payload: { text: 'outbound' } })
    expect(send).toHaveBeenCalledWith({ text: 'outbound' }, expect.any(AbortSignal))

    await unregister()
    await expect(context?.deliver({ text: 'late' })).rejects.toThrow('is not active')
  })

  it('rejects invalid or duplicate connector ids', () => {
    const { gateway } = fixture()
    const connector = { id: 'slack', start: () => {}, send: async () => {} }
    gateway.register(connector)

    expect(() => gateway.register(connector)).toThrow('already registered')
    expect(() => gateway.register({ ...connector, id: 'Slack API' })).toThrow('lower-kebab-case')
  })

  it('keeps the connector registry available before Mailbox is bound', async () => {
    const gateway = new FleetGatewayService()
    let context: FleetGatewayConnectorContext | undefined
    gateway.register({ id: 'webhook', start: value => { context = value }, send: async () => {} })

    expect(gateway.list().map(connector => connector.id)).toEqual(['webhook'])
    await expect(context?.deliver({ text: 'early' })).rejects.toThrow('Mailbox is not connected')
  })

  it('stops connectors and outbound delivery when closed', async () => {
    const { gateway, outbound } = fixture()
    const stop = vi.fn()
    gateway.register({ id: 'http', start: () => stop, send: async () => {} })

    await gateway.close()
    expect(stop).toHaveBeenCalledOnce()
    expect(outbound()).toBeUndefined()
    expect(() => gateway.register({ id: 'other', start: () => {}, send: async () => {} }))
      .toThrow('is closed')
  })
})
