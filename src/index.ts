import type { Context } from '@deepseek-ai/cordis'
import * as Core from '@dsh-agent-fleet/core'
import * as Message from '@dsh-agent-fleet/message'
import * as Resources from '@dsh-agent-fleet/resources'
import { connectRunObservers, FleetRunService, installRunTools } from './run.js'

export { Core, Message, Resources }
export * from './run.js'

export const name = 'dsh-agent-fleet'

export function apply(ctx: Context): void {
  ctx.plugin(Core)
  ctx.plugin(Resources)
  ctx.plugin(Message)
  ctx.inject(['fleetCore', 'fleetMessages', 'fleetResources', 'agents', 'sessions', 'tools'], (scope) => {
    const service = new FleetRunService(scope, scope.fleetCore, scope.fleetMessages, scope.fleetResources)
    scope.provide('fleetRuns', service)
    installRunTools(scope, service)
    const disconnect = connectRunObservers(service, scope.fleetMessages, scope.fleetResources)
    scope.effect(() => () => {
      disconnect()
      service.close()
    }, 'fleetRuns.close()')
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetRuns: FleetRunService
  }
}
