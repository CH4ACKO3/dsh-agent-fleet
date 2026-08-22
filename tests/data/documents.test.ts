import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FLEET_DOCUMENT_STATE_NAMESPACE,
  FleetDocumentService,
  parseFleetDocumentState,
  type FleetDocumentFiles,
} from '../../src/data/documents.js'
import type { FleetRunService } from '../../src/run.js'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fleet-documents-'))
  temporaryRoots.push(root)
  return root
}

function fixture(roots: Record<string, string> = { 'team-1': temporaryRoot() }) {
  const stored = new Map<string, unknown>()
  const runs = {
    status: (teamId: string) => ({ id: teamId, projectRoot: roots[teamId] }),
    readExtensionState: (teamId: string, namespace: string) => stored.get(`${teamId}:${namespace}`),
    writeExtensionState: (teamId: string, namespace: string, value: unknown) => {
      stored.set(`${teamId}:${namespace}`, structuredClone(value))
    },
  } as unknown as FleetRunService
  const files: FleetDocumentFiles = {
    exists: path => Promise.resolve(existsSync(path)),
    read: path => readFile(path, 'utf8'),
    async write(path, content) {
      mkdirSync(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    },
  }
  return { files, roots, runs, stored, service: new FleetDocumentService(runs) }
}

describe('FleetDocumentService', () => {
  it('keeps current content and version history as real Team files', async () => {
    const { files, roots, service, stored } = fixture()
    const created = await service.create('team-1', 'alice', {
      name: 'design-notes', title: 'Design notes', content: 'version one unique content',
    }, files)
    expect(created).toMatchObject({ name: 'design-notes', version: 1, content: 'version one unique content' })
    expect(readFileSync(join(roots['team-1']!, '.fleet', 'team-1', 'documents', 'design-notes.md'), 'utf8'))
      .toBe('version one unique content')

    const updated = await service.update('team-1', 'bob', created.id, { content: 'version two' }, files)
    expect(updated.version).toBe(2)
    const commented = await service.comment('team-1', 'reviewer', created.id, 'Clarify the boundary.', files)
    const commentId = commented.comments[0]!.id
    const replied = await service.comment('team-1', 'alice', created.id, 'Clarified.', files, commentId)
    expect(replied.comments[1]).toMatchObject({ parentId: commentId, text: 'Clarified.' })
    const resolved = await service.resolveComment('team-1', 'reviewer', created.id, commentId, files)
    expect(resolved.comments[0]).toMatchObject({ resolved: true, resolvedBy: 'reviewer' })

    const reverted = await service.revert('team-1', 'alice', created.id, 1, files)
    expect(reverted).toMatchObject({ version: 3, content: 'version one unique content' })
    expect(readFileSync(join(
      roots['team-1']!, '.fleet', 'team-1', 'documents', '.history', created.id, '2.md',
    ), 'utf8')).toBe('version two')
    expect(JSON.stringify(stored.get(`team-1:${FLEET_DOCUMENT_STATE_NAMESPACE}`)))
      .not.toContain('version one unique content')
  })

  it('resumes from extension metadata and archived Team files', async () => {
    const sourceRoot = temporaryRoot()
    const targetRoot = temporaryRoot()
    const first = fixture({ 'team-1': sourceRoot, 'team-2': targetRoot })
    const created = await first.service.create('team-1', 'alice', {
      name: 'experiment-log', title: 'Experiment log', content: 'durable result',
    }, first.files)

    const restored = new FleetDocumentService(first.runs)
    await expect(restored.get('team-1', created.id, first.files)).resolves.toMatchObject({ content: 'durable result' })

    const sourceShared = join(sourceRoot, '.fleet', 'team-1')
    const targetShared = join(targetRoot, '.fleet', 'team-2')
    mkdirSync(dirname(targetShared), { recursive: true })
    cpSync(sourceShared, targetShared, { recursive: true })
    first.stored.set(
      `team-2:${FLEET_DOCUMENT_STATE_NAMESPACE}`,
      structuredClone(first.stored.get(`team-1:${FLEET_DOCUMENT_STATE_NAMESPACE}`)),
    )
    const copied = new FleetDocumentService(first.runs)
    await expect(copied.get('team-2', created.id, first.files)).resolves.toMatchObject({
      name: 'experiment-log', content: 'durable result',
    })
  })

  it('serializes Team metadata updates from concurrent members', async () => {
    const current = fixture()
    const delayed: FleetDocumentFiles = {
      ...current.files,
      async write(path, content, signal) {
        await new Promise<void>(resolve => { setImmediate(resolve) })
        await current.files.write(path, content, signal)
      },
    }
    await Promise.all([
      current.service.create('team-1', 'alice', { name: 'alpha', title: 'Alpha' }, delayed),
      current.service.create('team-1', 'bob', { name: 'beta', title: 'Beta' }, delayed),
    ])
    expect(current.service.state('team-1').documents.map(document => document.name).sort()).toEqual(['alpha', 'beta'])
  })

  it('rejects malformed current-format metadata', () => {
    expect(() => parseFleetDocumentState({ version: 1, documents: [{ id: 'broken' }] } as never))
      .toThrow(/Fleet Document state/u)
  })
})
