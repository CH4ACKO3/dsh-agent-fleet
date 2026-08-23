import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import {
  FleetAuthorizationService,
  FleetConfigurationRegistry,
  type FleetRunService,
} from 'dsh-agent-fleet'

import {
  FleetAccessService,
  FleetGroupService,
  FleetPermissionService,
  apply,
} from '../../src/authorization/index.js'

describe('Agent Fleet Authorization module', () => {
  it('installs Permissions and Access together', async () => {
    const ctx = new Context()
    const authorization = new FleetAuthorizationService()
    const runs = {
      readExtensionState: () => undefined,
      writeExtensionState: () => {},
    } as unknown as FleetRunService

    apply(ctx)
    ctx.provide('fleetAuthorization', authorization)
    ctx.provide('fleetRuns', runs)
    ctx.provide('fleetConfiguration', new FleetConfigurationRegistry())
    await new Promise<void>(resolve => { setImmediate(resolve) })

    expect(ctx.get('fleetPermissions')).toBeInstanceOf(FleetPermissionService)
    expect(ctx.get('fleetAccess')).toBeInstanceOf(FleetAccessService)
    expect(ctx.get('fleetGroups')).toBeInstanceOf(FleetGroupService)
    expect(authorization.actionIds()).toEqual(expect.arrayContaining([
      'permissions.manage', 'access.inspect', 'access.manage',
    ]))
    expect(() => authorization.installActionPolicy({ resolve: () => undefined })).toThrow(/already installed/)
    expect(() => authorization.installResourcePolicy({ authorize: () => true })).toThrow(/already installed/)
  })
})
