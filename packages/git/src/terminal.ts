import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { basename, resolve } from 'node:path'

export interface FleetTerminalGitCommand {
  readonly cwd: string
  readonly verb: string
  readonly args: readonly string[]
  readonly repositoryOverride: boolean
}

export interface FleetTerminalGitPolicy {
  readonly actions: readonly string[]
  readonly intent: 'read' | 'write'
  readonly directWorktreeMutation: boolean
}

const READ_ONLY = new Set([
  '--version', 'annotate', 'archive', 'blame', 'cat-file', 'check-attr', 'check-ignore',
  'check-mailmap', 'check-ref-format', 'count-objects', 'describe', 'diff', 'diff-files',
  'diff-index', 'diff-tree', 'for-each-ref', 'grep', 'help', 'log', 'ls-files', 'ls-remote',
  'ls-tree', 'merge-base', 'name-rev', 'rev-list', 'rev-parse', 'shortlog', 'show',
  'show-branch', 'status', 'version', 'whatchanged',
])

const HISTORY_REWRITE = new Set([
  'clean', 'filter-branch', 'rebase', 'replace', 'reset', 'update-ref',
])

const REPOSITORY_MANAGE = new Set([
  'config', 'gc', 'init', 'maintenance', 'pack-refs', 'prune', 'remote', 'repack',
])

function textField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.trim().length > 0 ? field : undefined
}

function splitShellCommands(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  const finish = (): void => {
    if (current.trim().length > 0) segments.push(current.trim())
    current = ''
  }
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] as string
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\') {
      current += character
      escaped = true
      continue
    }
    if (quote !== undefined) {
      current += character
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if (character === ';' || character === '\n' || character === '|' || character === '&') {
      finish()
      while (command[index + 1] === character) index += 1
      continue
    }
    current += character
  }
  finish()
  return segments
}

function shellWords(segment: string): string[] {
  return [...segment.matchAll(/"((?:\\.|[^"])*)"|'([^']*)'|((?:\\.|[^\s])+)/gu)].map(match => {
    const value = match[1] ?? match[2] ?? match[3] ?? ''
    return value.replace(/\\(.)/gu, '$1')
  })
}

function gitCommand(words: readonly string[], initialCwd: string): FleetTerminalGitCommand | undefined {
  let index = 0
  if (words[index] === 'env') {
    index += 1
    while (words[index]?.includes('=') === true) index += 1
  }
  if (words[index] === 'command') index += 1
  if (basename(words[index] ?? '') !== 'git') return undefined
  index += 1
  let cwd = initialCwd
  let repositoryOverride = false
  while (index < words.length) {
    const value = words[index] as string
    if (value === '-C') {
      const path = words[index + 1]
      if (path === undefined) return undefined
      cwd = resolve(cwd, path)
      index += 2
      continue
    }
    if (value.startsWith('-C') && value.length > 2) {
      cwd = resolve(cwd, value.slice(2))
      index += 1
      continue
    }
    if (value === '-c') {
      index += 2
      continue
    }
    if (['--git-dir', '--work-tree'].includes(value)) {
      repositoryOverride = true
      index += 2
      continue
    }
    if (value.startsWith('--git-dir=') || value.startsWith('--work-tree=')) {
      repositoryOverride = true
      index += 1
      continue
    }
    if (value.startsWith('-') && !['--version'].includes(value)) {
      index += 1
      continue
    }
    return { cwd, verb: value.toLocaleLowerCase(), args: words.slice(index + 1), repositoryOverride }
  }
  return undefined
}

export function terminalGitCommands(exec: Readonly<ToolExecution>): FleetTerminalGitCommand[] {
  if (exec.agent === undefined || !['bash', 'exec_command'].includes(exec.name)) return []
  const command = textField(exec.arguments, 'command') ?? textField(exec.arguments, 'cmd') ?? textField(exec.arguments, 'script')
  if (command === undefined) return []
  let cwd = textField(exec.arguments, 'cwd') ?? textField(exec.arguments, 'workdir') ?? exec.agent.session.header.cwd ?? process.cwd()
  const result: FleetTerminalGitCommand[] = []
  for (const segment of splitShellCommands(command)) {
    const words = shellWords(segment)
    if (words[0] === 'cd' && words[1] !== undefined) {
      cwd = resolve(cwd, words[1])
      continue
    }
    const parsed = gitCommand(words, cwd)
    if (parsed !== undefined) result.push(parsed)
  }
  return result
}

function hasAny(args: readonly string[], values: readonly string[]): boolean {
  return args.some(value => values.includes(value) || values.some(prefix => value.startsWith(`${prefix}=`)))
}

function hasOperand(args: readonly string[]): boolean {
  return args.some(value => value !== '--' && !value.startsWith('-'))
}

function inspect(): FleetTerminalGitPolicy {
  return { actions: ['git.inspect'], intent: 'read', directWorktreeMutation: false }
}

function write(...additional: string[]): FleetTerminalGitPolicy {
  return { actions: ['git.scope-check', ...additional], intent: 'write', directWorktreeMutation: false }
}

export function terminalGitPolicy(command: FleetTerminalGitCommand): FleetTerminalGitPolicy {
  const { args, verb } = command
  if (READ_ONLY.has(verb)) return inspect()
  if (verb === 'branch') {
    const readSelector = hasAny(args, ['-a', '--all', '-r', '--remotes', '-l', '--list', '-v', '-vv', '--verbose', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--show-current', '--format'])
    const mutation = hasAny(args, ['-d', '-D', '-m', '-M', '-c', '-C', '-f', '--force', '--delete', '--move', '--copy', '--edit-description', '--set-upstream-to', '--unset-upstream'])
      || (hasOperand(args) && !readSelector)
    return mutation ? write('git.history-rewrite') : inspect()
  }
  if (verb === 'tag') {
    const mutation = hasOperand(args) && !hasAny(args, ['-l', '--list', '--contains', '--points-at', '--merged', '--no-merged'])
      || hasAny(args, ['-d', '--delete', '-f', '--force', '-a', '--annotate', '-s', '--sign'])
    return mutation ? write('git.history-rewrite') : inspect()
  }
  if (verb === 'stash') return ['list', 'show'].includes(args[0] ?? 'list') ? inspect() : write()
  if (verb === 'reflog') return ['show', 'exists'].includes(args[0] ?? 'show') ? inspect() : write('git.history-rewrite')
  if (verb === 'notes') return ['list', 'show'].includes(args[0] ?? 'list') ? inspect() : write()
  if (verb === 'worktree') return (args[0] ?? 'list') === 'list'
    ? inspect()
    : { actions: ['git.repository-manage'], intent: 'write', directWorktreeMutation: true }
  if (verb === 'remote') return args.length === 0 || ['-v', '--verbose', 'get-url', 'show'].includes(args[0] ?? '')
    ? inspect()
    : write('git.repository-manage')
  if (verb === 'config') {
    const read = args.length < 2 || hasAny(args, ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l', '--show-origin', '--show-scope'])
    return read ? inspect() : write('git.repository-manage')
  }
  if (verb === 'push') {
    const force = hasAny(args, ['-f', '--force', '--force-with-lease', '--force-if-includes', '-d', '--delete'])
      || args.some(value => value.startsWith('+') || value.startsWith(':'))
    return write('git.publish', ...(force ? ['git.history-rewrite'] : []))
  }
  if (verb === 'commit') return write(...(hasAny(args, ['--amend']) ? ['git.history-rewrite'] : []))
  if (verb === 'pull') return write(...(hasAny(args, ['--rebase']) ? ['git.history-rewrite'] : []))
  if (['checkout', 'switch'].includes(verb) && !args.includes('--')) {
    const rewrite = hasAny(args, ['-B', '-C', '-f', '--force', '--discard-changes'])
    return write('git.repository-manage', ...(rewrite ? ['git.history-rewrite'] : []))
  }
  if (verb === 'submodule' && ['status', 'summary'].includes(args[0] ?? 'status')) return inspect()
  if (HISTORY_REWRITE.has(verb)) return write('git.history-rewrite')
  if (REPOSITORY_MANAGE.has(verb) || verb === 'clone') return write('git.repository-manage')
  return write()
}
