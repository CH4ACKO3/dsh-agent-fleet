#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const API = 'https://export.arxiv.org/api/query'
const USER_AGENT = 'dsh-agent-fleet-literature-filter/0.1 (local research harness)'
const ALLOWED_HOSTS = new Set(['arxiv.org', 'export.arxiv.org'])

function decodeXml(value) {
  return value
    .replaceAll(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll(/&#([0-9]+);/gu, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function text(entry, tag) {
  const match = entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'iu'))
  return match === null ? undefined : decodeXml(match[1].replaceAll(/\s+/gu, ' ').trim())
}

export function parseArxivFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/giu)].flatMap((match) => {
    const entry = match[1]
    const url = text(entry, 'id')
    const title = text(entry, 'title')
    const summary = text(entry, 'summary')
    const published = text(entry, 'published')
    const updated = text(entry, 'updated')
    const id = url?.match(/\/abs\/([^?#]+)/u)?.[1]
    if (id === undefined || title === undefined || summary === undefined || published === undefined) return []
    const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/giu)]
      .map(author => decodeXml(author[1].replaceAll(/\s+/gu, ' ').trim()))
    const categories = [...entry.matchAll(/<category\s+term=["']([^"']+)["'][^>]*\/?\s*>/giu)]
      .map(category => decodeXml(category[1]))
    return [{
      id,
      title,
      authors,
      summary,
      published,
      ...(updated === undefined ? {} : { updated }),
      categories,
      abstractUrl: `https://arxiv.org/abs/${id}`,
      pdfUrl: `https://export.arxiv.org/pdf/${id}`,
    }]
  })
}

export function cutoffTime(value) {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error('A literature cutoff is required')
  const time = /^\d{4}-\d{2}-\d{2}$/u.test(normalized)
    ? Date.parse(`${normalized}T23:59:59.999Z`)
    : Date.parse(normalized)
  if (!Number.isFinite(time)) throw new Error(`Invalid literature cutoff: ${value}`)
  return time
}

export function beforeCutoff(entry, cutoff) {
  const published = Date.parse(entry.published)
  return Number.isFinite(published) && published <= cutoffTime(cutoff)
}

function options(args) {
  const result = { _: [] }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      result._.push(argument)
      continue
    }
    const key = argument.slice(2)
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    result[key] = value
    index += 1
  }
  return result
}

function required(value, name) {
  const normalized = value?.trim() ?? ''
  if (normalized.length === 0) throw new Error(`${name} is required`)
  return normalized
}

function cutoff(input) {
  return required(input.cutoff ?? process.env.FLEET_LITERATURE_CUTOFF, '--cutoff or FLEET_LITERATURE_CUTOFF')
}

async function request(url, accept) {
  let failure
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept, 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      })
      if (!ALLOWED_HOSTS.has(new URL(response.url).hostname)) {
        throw new Error(`arXiv redirected to a disallowed host: ${response.url}`)
      }
      if (response.ok || (response.status !== 429 && response.status < 500)) return response
      failure = new Error(`HTTP ${response.status}`)
    } catch (error) {
      failure = error
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 750))
  }
  throw new Error(`arXiv request failed: ${failure instanceof Error ? failure.message : String(failure)}`)
}

async function query(params) {
  const url = new URL(API)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const response = await request(url, 'application/atom+xml')
  if (!response.ok) throw new Error(`arXiv API returned HTTP ${response.status}`)
  return parseArxivFeed(await response.text())
}

async function search(input) {
  const searchText = required(input.query, '--query')
  const date = cutoff(input)
  const limit = Number.parseInt(input.limit ?? '8', 10)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('--limit must be from 1 through 20')
  const entries = await query({
    search_query: `all:\"${searchText.replaceAll('"', '')}\"`,
    start: 0,
    max_results: Math.min(limit * 5, 100),
    sortBy: 'relevance',
    sortOrder: 'descending',
  })
  return {
    source: 'arXiv',
    cutoff: date,
    query: searchText,
    results: entries.filter(entry => beforeCutoff(entry, date)).slice(0, limit),
  }
}

async function get(input) {
  const id = required(input.id, '--id').replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//u, '').replace(/\.pdf$/u, '')
  if (!/^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$|^\d{4}\.\d{4,5}(?:v\d+)?$/iu.test(id)) {
    throw new Error(`Invalid arXiv id: ${id}`)
  }
  const date = cutoff(input)
  const [entry] = await query({ id_list: id.replace(/v\d+$/iu, ''), max_results: 1 })
  if (entry === undefined) throw new Error(`arXiv entry not found: ${id}`)
  if (!beforeCutoff(entry, date)) throw new Error(`arXiv entry ${entry.id} was published after cutoff ${date}`)
  return { source: 'arXiv', cutoff: date, result: entry }
}

async function download(input) {
  const metadata = await get(input)
  const output = required(input.output, '--output')
  const response = await request(metadata.result.pdfUrl, 'application/pdf')
  if (!response.ok) throw new Error(`arXiv PDF returned HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/pdf')) throw new Error(`arXiv returned unexpected content type: ${contentType}`)
  const body = Buffer.from(await response.arrayBuffer())
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, body, { flag: 'wx' })
  return { ...metadata, output, bytes: body.byteLength }
}

function usage() {
  return [
    'Usage:',
    '  arxiv-filter.mjs search --query TEXT [--limit 8] [--cutoff YYYY-MM-DD]',
    '  arxiv-filter.mjs get --id ARXIV_ID [--cutoff YYYY-MM-DD]',
    '  arxiv-filter.mjs download --id ARXIV_ID --output FILE [--cutoff YYYY-MM-DD]',
    '',
    'The cutoff may also be supplied through FLEET_LITERATURE_CUTOFF.',
  ].join('\n')
}

export async function main(args = process.argv.slice(2)) {
  const input = options(args)
  const command = input._[0]
  if (command === undefined || command === 'help') {
    console.log(usage())
    return
  }
  const result = command === 'search'
    ? await search(input)
    : command === 'get'
      ? await get(input)
      : command === 'download'
        ? await download(input)
        : undefined
  if (result === undefined) throw new Error(`Unknown command: ${command}`)
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
