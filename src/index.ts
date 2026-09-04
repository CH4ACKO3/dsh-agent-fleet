import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionPeers, HostPeerRemote } from 'the-binding-of-dsh'
import * as Core from '@dsh-agent-fleet/core'
import * as Gateway from '@dsh-agent-fleet/gateway'
import { FLEET_WEB_PEER_REMOTE, type FleetWebPeerClient } from '@dsh-agent-fleet/core/web'
import * as Message from '@dsh-agent-fleet/message'
import * as Resources from '@dsh-agent-fleet/resources'
import * as Authorization from './authorization/index.js'
import * as Data from './data/index.js'
import { FleetArchiveRegistry } from './archive.js'
import { FleetAssistantRuntime } from './assistant.js'
import { activateFleetAutoBootstrap, writeFleetAutoBootstrapFailure } from './auto-bootstrap.js'
import { activateResidentFleetAssistants } from './resident-assistants.js'
import { FleetAuthorizationService } from './authorization.js'
import { installFleetActivationBridge } from './activation.js'
import { FleetCollaborationService } from './collaboration.js'
import { FleetConfigurationRegistry } from './configuration.js'
import { FleetMetaAssistantService } from './meta.js'
import { createFleetMailbox, type FleetMailboxService } from './mailbox.js'
import { FleetRunService, installRunTools } from './run.js'
import { FleetSetupService, installSetupTool } from './setup.js'
import { FLEET_WEB_LOCAL, FleetWebRemote } from './web.js'

export { Authorization, Core, Data, Message, Resources }
export {
  FleetGatewayService,
  type FleetGatewayConnector,
  type FleetGatewayConnectorContext,
  type FleetGatewayInbound,
  type FleetGatewayMailbox,
  type FleetGatewayOutbound,
} from '@dsh-agent-fleet/gateway'
export * from './authorization/index.js'
export * from './data/index.js'
export * from './authorization.js'
export * from './assistant.js'
export * from './auto-bootstrap.js'
export * from './archive.js'
export * from './activation.js'
export * from './collaboration.js'
export * from './configuration.js'
export * from './member-view.js'
export * from './tool-discovery.js'
export * from './meta.js'
export * from './mailbox.js'
export * from './productivity/index.js'
export * from './run.js'
export * from './setup.js'
export * from './team-events.js'
export * from './turn-reminders.js'
export * from './web.js'

export const name = 'dsh-agent-fleet'

interface FleetWebBindingContext extends Context {
  readonly connection: { readonly peers: HostConnectionPeers }
  readonly remote: HostPeerRemote
}

async function installFleetWebNotifications(ctx: FleetWebBindingContext, runs: FleetRunService): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(FLEET_WEB_PEER_REMOTE)
  let active = true
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let traceScheduled: ReturnType<typeof setTimeout> | undefined
  const pendingTraces = new Map<string, { readonly teamId: string; readonly memberId: string }>()
  const notifyPeer = (peer: ReturnType<HostConnectionPeers['list']>[number]): void => {
    if (!active || peer.kind !== 'browser') return
    const client = (ctx.remote.for(peer) as unknown as { fleetWebPeer: FleetWebPeerClient }).fleetWebPeer
    void client.invalidate().catch(() => undefined)
  }
  const notifyAll = (): void => {
    if (!active || scheduled !== undefined) return
    scheduled = setTimeout(() => {
      scheduled = undefined
      if (!active) return
      for (const peer of ctx.connection.peers.list()) notifyPeer(peer)
    }, 500)
  }
  const notifyTrace = (teamId: string, memberId: string): void => {
    if (!active) return
    pendingTraces.set(`${teamId}\0${memberId}`, { teamId, memberId })
    if (traceScheduled !== undefined) return
    traceScheduled = setTimeout(() => {
      traceScheduled = undefined
      if (!active || pendingTraces.size === 0) return
      const traces = [...pendingTraces.values()]
      pendingTraces.clear()
      for (const peer of ctx.connection.peers.list()) {
        if (peer.kind !== 'browser') continue
        const client = (ctx.remote.for(peer) as unknown as { fleetWebPeer: FleetWebPeerClient }).fleetWebPeer
        void client.invalidateTraces({ traces }).catch(() => undefined)
      }
    }, 250)
  }
  const unsubscribeChanges = runs.subscribeChanges(notifyAll)
  const unsubscribeTraceChanges = runs.subscribeTraceChanges(notifyTrace)
  const unsubscribePeers = ctx.connection.peers.subscribe(change => {
    if (change.type === 'added') notifyPeer(change.peer)
  })
  return async () => {
    active = false
    if (scheduled !== undefined) clearTimeout(scheduled)
    if (traceScheduled !== undefined) clearTimeout(traceScheduled)
    unsubscribePeers()
    unsubscribeChanges()
    unsubscribeTraceChanges()
    await disposeRemote()
  }
}

export function apply(ctx: Context): void {
  ctx.plugin(Core)
  ctx.plugin(Gateway)
  ctx.inject(['fleetCore', 'agents', 'sessions', 'tools', 'fs', 'llm'], (scope) => {
    const archives = new FleetArchiveRegistry()
    const authorization = new FleetAuthorizationService()
    const configuration = new FleetConfigurationRegistry()
    const assistant = new FleetAssistantRuntime()
    const meta = new FleetMetaAssistantService(assistant)
    const collaboration = new FleetCollaborationService(scope, authorization)
    const service = new FleetRunService(scope, scope.fleetCore, collaboration, { archives, authorization, configuration })
    const mailbox = createFleetMailbox(service, message => scope.logger.warn(message))
    authorization.installBaseline(service.authorizationBaseline())
    const setups = new FleetSetupService(assistant, service, { configuration })
    scope.provide('fleetAuthorization', authorization)
    scope.provide('fleetAssistant', assistant)
    scope.provide('fleetArchives', archives)
    scope.provide('fleetCollaboration', collaboration)
    scope.provide('fleetConfiguration', configuration)
    scope.provide('fleetMetaAssistant', meta)
    scope.provide('fleetMailbox', mailbox)
    scope.provide('fleetRuns', service)
    scope.provide('fleetSetups', setups)
    installSetupTool(scope, setups)
    installFleetActivationBridge(scope, setups, service, assistant, meta)
    installRunTools(scope, service, assistant)
    let residentAssistants: Awaited<ReturnType<typeof activateResidentFleetAssistants>> | undefined
    let autoBootstrap: Awaited<ReturnType<typeof activateFleetAutoBootstrap>> | undefined
    scope.on('agent/disposed', ({ agent }) => {
      service.agentDisconnected(String(agent.id))
      assistant.disposed(String(agent.id))
      residentAssistants?.agentDisposed(String(agent.id))
    })
    scope.on('agent/session-start', ({ agent }) => {
      if (meta.restore(agent) === undefined) setups.restore(agent)
      service.agentSessionStarted(agent)
    })
    scope.on('session/event', (session, event) => {
      service.recordMemberSessionEvent(String(session.id), event)
    })
    scope.on('agent/status', ({ agent }) => {
      service.agentStatusChanged(agent)
    })
    scope.inject(['agentLoop'], async (residentScope) => {
      const controller = await activateResidentFleetAssistants(residentScope, service, assistant)
      residentAssistants = controller
      service.setResidentAssistantController(controller)
      try {
        autoBootstrap = await activateFleetAutoBootstrap(residentScope, service, assistant)
      } catch (error) {
        writeFleetAutoBootstrapFailure(error)
        residentScope.logger('dsh-agent-fleet').error(
          `Fleet auto bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      return async () => {
        const bootstrap = autoBootstrap
        autoBootstrap = undefined
        await bootstrap?.dispose()
        residentAssistants = undefined
        service.setResidentAssistantController(undefined)
        await controller.dispose()
      }
    })
    scope.effect(() => () => {
      assistant.close()
      mailbox.close()
      service.close()
    }, 'fleetRuns.close()')
  })
  Authorization.apply(ctx)
  Data.apply(ctx)
  ctx.inject(['fleetRuns', 'fleetSetups', 'fleetPermissions', 'fleetAssistant', 'fleetAccess', 'typert', 'agents'], (scope) => {
    new FleetWebRemote(
      scope,
      scope.fleetRuns,
      scope.fleetSetups,
      scope.fleetPermissions,
      scope.fleetAssistant,
      scope.fleetAccess,
    )
    return scope.typert.register(FLEET_WEB_LOCAL)
  })
  ctx.inject(['fleetRuns', 'remote', 'connection'], raw => {
    const scope = raw as FleetWebBindingContext & { readonly fleetRuns: FleetRunService }
    return installFleetWebNotifications(scope, scope.fleetRuns)
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetAssistant: FleetAssistantRuntime
    fleetArchives: FleetArchiveRegistry
    fleetAuthorization: FleetAuthorizationService
    fleetCollaboration: FleetCollaborationService
    fleetConfiguration: FleetConfigurationRegistry
    fleetMetaAssistant: FleetMetaAssistantService
    fleetMailbox: FleetMailboxService
    fleetRuns: FleetRunService
    fleetSetups: FleetSetupService
  }
}
