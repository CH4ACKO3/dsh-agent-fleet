import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from 'dsh-agent-fleet'

import { FleetGit, installGitTools } from './git.js'

import {
  FLEET_GIT_WEB_INVOCATIONS,
  type FleetGitDiffInput,
  type FleetGitSnapshotInput,
} from './contract.js'

export * from './contract.js'
export * from './git.js'

export const name = '@ch4acko3/dsh-agent-fleet-git'
export const inject = ['fleetAuthorization'] as const

export const FLEET_GIT_PERMISSIONS = [
  { id: 'inspect', description: 'Inspect Git operation scope.' },
  { id: 'scope-check', description: 'Check a proposed terminal Git operation against its allowed scope.' },
  { id: 'worktree-create', description: 'Create a member Git worktree.' },
  { id: 'worktree-manage', description: 'Create a Git worktree for another member.' },
] as const

const FLEET_GIT_WEB_LOCAL: TypertContribution = {
  package: '@ch4acko3/dsh-agent-fleet-git/web',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FLEET_GIT_WEB_INVOCATIONS,
}

function required(value: string | undefined, label: string): string {
  const result = value?.trim() ?? ''
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

export class FleetGitWebRemote extends TypertRemoteService {
  constructor(host: Context) {
    super(host, 'fleetGitWeb', { namespace: 'fleetGit' })
  }

  snapshot(input: FleetGitSnapshotInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const root = required(input.root, 'root')
    const limit = input.limit ?? 200
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be from 1 through 500')
    return new FleetGit(root).snapshot(root, limit)
  }

  diff(input: FleetGitDiffInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const root = required(input.root, 'root')
    const path = required(input.path, 'path')
    return new FleetGit(root).diff(root, path, input.staged ?? false)
  }
}

export function apply(ctx: Context): void {
  ctx.inject(['fleetAuthorization'], scope => {
    const stopNamespace = scope.fleetAuthorization.registerNamespace({
      namespace: 'git',
      actions: FLEET_GIT_PERMISSIONS,
      defaultActions: () => ['inspect', 'scope-check', 'worktree-create'],
      installTools(agentContext, input) {
        return installGitTools(
          agentContext,
          new FleetGit(input.projectRoot, undefined, input.teamId),
          {
            teamId: input.teamId,
            member: input.member.id,
            hasMember: input.hasMember,
            authorization: scope.fleetAuthorization,
            permissions: new Set(input.authorization.actions),
          },
        )
      },
    })
    const stopResource = scope.fleetAuthorization.registerResourceKind({
      kind: 'git-repository',
      authorizeBaseline: () => true,
    })
    return () => {
      stopResource()
      stopNamespace()
    }
  })
  ctx.inject(['typert'], scope => {
    new FleetGitWebRemote(scope)
    return scope.typert.register(FLEET_GIT_WEB_LOCAL)
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetGitWeb: FleetGitWebRemote
  }
}
