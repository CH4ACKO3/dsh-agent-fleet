#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import process from 'node:process'

import { REQUEST_TYPES, signRequest } from './protocol.mjs'

function parseArgs(values) {
  const result = { _: [] }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) {
      result._.push(value)
      continue
    }
    const key = value.slice(2)
    const next = values[index + 1]
    if (next === undefined || next.startsWith('--')) result[key] = true
    else {
      result[key] = next
      index += 1
    }
  }
  return result
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredText(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function optionalFile(path, label) {
  if (path === undefined) return undefined
  const normalized = requiredText(path, label)
  if (!isAbsolute(normalized) || !existsSync(normalized)) throw new Error(`${label} must be an existing absolute path`)
  const content = readFileSync(normalized, 'utf8')
  if (Buffer.byteLength(content) > 256 * 1024) throw new Error(`${label} cannot exceed 256 KiB`)
  return { name: basename(normalized), content }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  renameSync(temporary, path)
}

function submit(type, args) {
  if (!REQUEST_TYPES.includes(type)) throw new Error(`Unknown request type ${type}`)
  const control = requiredEnv('SELF_EVOLVE_CONTROL_DIR')
  const generation = requiredEnv('SELF_EVOLVE_GENERATION')
  const token = requiredEnv('SELF_EVOLVE_CONTROL_TOKEN')
  const bootstrap = optionalFile(args.bootstrap, '--bootstrap')
  const evidence = optionalFile(args.evidence, '--evidence')
  const handoff = optionalFile(args.handoff, '--handoff')
  const request = {
    id: randomUUID(),
    generation,
    type,
    createdAt: new Date().toISOString(),
    payload: {
      ...(args.ref === undefined ? {} : { sourceRef: requiredText(args.ref, '--ref') }),
      ...(args.reason === undefined ? {} : { reason: requiredText(args.reason, '--reason') }),
      ...(args.summary === undefined ? {} : { summary: requiredText(args.summary, '--summary') }),
      ...(bootstrap === undefined ? {} : { bootstrap }),
      ...(evidence === undefined ? {} : { evidence }),
      ...(handoff === undefined ? {} : { handoff }),
    },
  }
  const signed = { ...request, signature: signRequest(request, token) }
  const requests = join(control, 'requests')
  mkdirSync(requests, { recursive: true })
  atomicJson(join(requests, `${Date.now()}-${request.id}.json`), signed)
  process.stdout.write(`${JSON.stringify({ accepted: true, id: request.id, type })}\n`)
}

function eventFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter(name => /^\d+-.*\.json$/.test(name)).sort()
}

function nextEvent(directory, after) {
  for (const name of eventFiles(directory)) {
    const sequence = Number(name.split('-', 1)[0])
    if (sequence > after) return JSON.parse(readFileSync(join(directory, name), 'utf8'))
  }
  return undefined
}

async function waitForEvent(args) {
  const control = requiredEnv('SELF_EVOLVE_CONTROL_DIR')
  const generation = requiredEnv('SELF_EVOLVE_GENERATION')
  const directory = join(control, 'events', generation)
  const after = Number(args.after ?? 0)
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('--after must be a non-negative integer')
  mkdirSync(directory, { recursive: true })
  const present = nextEvent(directory, after)
  if (present !== undefined) {
    process.stdout.write(`${JSON.stringify(present)}\n`)
    return
  }
  await new Promise((resolve, reject) => {
    const watcher = watch(directory, { persistent: true }, () => {
      try {
        const event = nextEvent(directory, after)
        if (event === undefined) return
        watcher.close()
        process.stdout.write(`${JSON.stringify(event)}\n`)
        resolve()
      } catch (error) {
        watcher.close()
        reject(error)
      }
    })
    process.once('SIGINT', () => {
      watcher.close()
      reject(new Error('Event wait interrupted'))
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  if (command === 'info') {
    const path = '/workspace/.self-evolve/generation.json'
    if (!existsSync(path)) throw new Error(`Generation manifest is missing: ${path}`)
    process.stdout.write(`${JSON.stringify(JSON.parse(readFileSync(path, 'utf8')), null, 2)}\n`)
    return
  }
  if (command === 'watch') return waitForEvent(args)
  const types = {
    'start-candidate': 'candidate.start',
    'destroy-candidate': 'candidate.destroy',
    ready: 'candidate.ready',
    reject: 'candidate.reject',
    promote: 'generation.promote',
  }
  const type = types[command]
  if (type === undefined) {
    throw new Error('Usage: generation-control <info|start-candidate|destroy-candidate|ready|reject|promote|watch> [options]')
  }
  submit(type, args)
}

main().catch(error => {
  process.stderr.write(`generation-control: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
