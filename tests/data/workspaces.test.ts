import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FleetArchiveRegistry } from '../../src/archive.js'
import {
  FLEET_WORKSPACE_STATE_NAMESPACE,
  FleetWorkspaceService,
  installWorkspaceArchive,
  parseFleetWorkspaceState,
} from '../../src/data/workspaces.js'
import type { FleetRunService } from '../../src/run.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true })
})

function fixture(root: string, teamId = 'team-one') {
  const states = new Map<string, unknown>()
  const members = [{ id: 'lead' }, { id: 'reviewer' }]
  const runs = {
    status: (id: string) => {
      if (id !== teamId) throw new Error(`unknown team ${id}`)
      return { id, projectRoot: root, startedAt: '2026-08-23T00:00:00.000Z' }
    },
    memberViews: (id: string) => {
      if (id !== teamId) throw new Error(`unknown team ${id}`)
      return members
    },
    readExtensionState: (id: string, namespace: string) => states.get(`${id}:${namespace}`),
    writeExtensionState: (id: string, namespace: string, value: unknown) => {
      states.set(`${id}:${namespace}`, structuredClone(value))
    },
  } as unknown as FleetRunService
  return { runs, states, service: new FleetWorkspaceService(runs) }
}

describe('FleetWorkspaceService', () => {
  it('keeps the native project workspace and persists explicit member mounts', () => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-workspaces-'))
    temporaryDirectories.push(root)
    const source = fixture(root)
    const research = join(root, 'research')
    mkdirSync(research)

    expect(source.service.mounts('team-one', 'lead')).toMatchObject([
      { id: 'project', name: 'project', path: realpathSync(root), access: 'write', builtIn: true },
    ])
    const attached = source.service.attach('team-one', 'lead', { name: 'research', path: 'research' })
    expect(attached).toMatchObject({ name: 'research', path: realpathSync(research), createdBy: 'lead' })
    expect(source.service.assign('team-one', 'reviewer', [
      { workspaceId: 'project', access: 'read' },
      { workspaceId: attached.id, access: 'write' },
    ])).toMatchObject([
      { id: 'project', access: 'read' },
      { id: attached.id, access: 'write' },
    ])

    const restarted = new FleetWorkspaceService(source.runs)
    expect(restarted.mounts('team-one', 'reviewer')).toMatchObject([
      { id: 'project', access: 'read' },
      { id: attached.id, name: 'research', access: 'write' },
    ])
    restarted.detach('team-one', attached.id)
    expect(restarted.mounts('team-one', 'reviewer')).toEqual([
      expect.objectContaining({ id: 'project', access: 'read' }),
    ])
  })

  it('relocates project-contained mounts when an archive is imported into a new root', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'fleet-workspace-source-'))
    const targetRoot = mkdtempSync(join(tmpdir(), 'fleet-workspace-target-'))
    const archiveRoot = mkdtempSync(join(tmpdir(), 'fleet-workspace-archive-'))
    temporaryDirectories.push(sourceRoot, targetRoot, archiveRoot)
    mkdirSync(join(sourceRoot, 'packages'))
    mkdirSync(join(targetRoot, 'packages'))
    const source = fixture(sourceRoot, 'source-team')
    source.service.attach('source-team', 'lead', { name: 'packages', path: 'packages' })
    const saved = new FleetArchiveRegistry()
    installWorkspaceArchive(source.service, saved)
    await saved.save({ id: 'source-team', name: 'Source', projectRoot: sourceRoot, status: 'paused' }, archiveRoot)

    const target = fixture(targetRoot, 'target-team')
    const restored = new FleetArchiveRegistry()
    installWorkspaceArchive(target.service, restored)
    await restored.restore(
      { id: 'target-team', name: 'Target', projectRoot: targetRoot, status: 'paused' },
      archiveRoot,
      {
        sourceTeam: { id: 'source-team', name: 'Source', projectRoot: sourceRoot, status: 'paused' },
        sessionIdMap: {},
      },
    )
    expect(target.service.workspaces('target-team')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'packages', path: realpathSync(join(targetRoot, 'packages')) }),
    ]))
    expect(target.states.get(`target-team:${FLEET_WORKSPACE_STATE_NAMESPACE}`)).toBeDefined()
  })

  it('rejects malformed current-format state', () => {
    expect(() => parseFleetWorkspaceState({
      version: 1,
      workspaces: [],
      members: { lead: [{ workspaceId: 'missing', access: 'write' }] },
    })).toThrow('workspaceId is invalid')
  })
})
