#!/usr/bin/env node

import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { once } from 'node:events'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { finished } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createGzip } from 'node:zlib'

function journalEvent(line, path, index) {
  try {
    const event = JSON.parse(line)
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 || typeof event.type !== 'string') {
      throw new Error('missing a positive sequence or event type')
    }
    return event
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${path}:${String(index + 1)} is not a valid Fleet journal event: ${reason}`)
  }
}

async function write(stream, value) {
  if (!stream.write(value)) await once(stream, 'drain')
}

export async function compactFleetJournal(inputPath) {
  const requested = resolve(inputPath)
  if (!existsSync(requested)) throw new Error(`Fleet journal does not exist: ${requested}`)
  if (lstatSync(requested).isSymbolicLink()) throw new Error('Fleet journal compaction does not follow symbolic links')
  const path = realpathSync(requested)
  if (basename(path) !== 'events.jsonl' || !lstatSync(path).isFile()) {
    throw new Error('Fleet journal compaction requires an explicit events.jsonl file')
  }

  const beforeBytes = statSync(path).size
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const archive = join(dirname(path), `events.session-archive.${timestamp}.jsonl.gz`)
  if (existsSync(archive)) throw new Error(`Fleet journal archive already exists: ${archive}`)
  const archiveTemporary = `${archive}.${process.pid}.tmp`
  const journalTemporary = `${path}.${process.pid}.tmp`
  const journalOutput = createWriteStream(journalTemporary, { encoding: 'utf8' })
  const archiveOutput = createWriteStream(archiveTemporary)
  const gzip = createGzip({ level: 9 })
  gzip.pipe(archiveOutput)
  let removed = 0
  let lineNumber = 0
  let maxSequence = 0
  let maxSequenceCreatedAt = new Date(0).toISOString()
  let maxKeptSequence = 0
  try {
    const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of lines) {
      if (line.length === 0) continue
      const event = journalEvent(line, path, lineNumber)
      lineNumber += 1
      if (event.sequence > maxSequence) {
        maxSequence = event.sequence
        maxSequenceCreatedAt = event.createdAt
      }
      if (event.type.startsWith('session.')) {
        removed += 1
        await write(gzip, `${line}\n`)
      } else {
        maxKeptSequence = Math.max(maxKeptSequence, event.sequence)
        await write(journalOutput, `${line}\n`)
      }
    }
    if (maxKeptSequence < maxSequence) {
      await write(journalOutput, `${JSON.stringify({
        sequence: maxSequence,
        createdAt: maxSequenceCreatedAt,
        type: 'journal_compacted',
        data: { removedSessionEvents: removed, archive: basename(archive) },
      })}\n`)
    }
    journalOutput.end()
    gzip.end()
    await Promise.all([finished(journalOutput), finished(archiveOutput)])
    if (removed === 0) {
      rmSync(journalTemporary, { force: true })
      rmSync(archiveTemporary, { force: true })
      return { path, removed: 0, beforeBytes, afterBytes: beforeBytes }
    }
    const afterBytes = statSync(journalTemporary).size
    renameSync(archiveTemporary, archive)
    renameSync(journalTemporary, path)
    return { path, archive, removed, beforeBytes, afterBytes }
  } catch (error) {
    journalOutput.destroy()
    gzip.destroy()
    archiveOutput.destroy()
    rmSync(journalTemporary, { force: true })
    rmSync(archiveTemporary, { force: true })
    throw error
  }
}

async function main() {
  const [offline, ...paths] = process.argv.slice(2)
  if (offline !== '--offline' || paths.length === 0) {
    throw new Error('Usage: compact-fleet-journal --offline <events.jsonl> [...] (stop the DSH host first)')
  }
  for (const path of paths) process.stdout.write(`${JSON.stringify(await compactFleetJournal(path))}\n`)
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
