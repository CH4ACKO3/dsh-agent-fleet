#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { HOST_GENERATION_MARKER, advancePromotionWindow, authorizeRequest, stripHostGenerationFooter, verifyRequest } from './protocol.mjs'

const execFileAsync = promisify(execFile)
const generationMonitors = new Map()

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

function requiredText(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function requiredAbsolute(value, name) {
  const normalized = requiredText(value, name)
  if (!isAbsolute(normalized)) throw new Error(`${name} must be an absolute path`)
  return resolve(normalized)
}

function validateJsonDocument(content, name) {
  try {
    JSON.parse(content)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${name} is not valid JSON: ${detail}`, { cause: error })
  }
  return content
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function readState(stateDirectory) {
  return JSON.parse(readFileSync(join(stateDirectory, 'state.json'), 'utf8'))
}

function writeState(stateDirectory, state) {
  atomicJson(join(stateDirectory, 'state.json'), state)
}

function writeGenerationManifest(generation, role) {
  atomicJson(join(generation.workspace, '.self-evolve', 'generation.json'), {
    schemaVersion: 1,
    id: generation.id,
    number: generation.number,
    role,
    parent: generation.parent,
    sourceRef: generation.sourceRef,
    sourceCommit: generation.sourceCommit,
    gitBranch: generation.gitBranch,
    createdAt: generation.createdAt,
    ...(generation.promotedAt === undefined ? {} : { promotedAt: generation.promotedAt }),
  })
}

function publicState(state) {
  return {
    ...state,
    generations: Object.fromEntries(Object.entries(state.generations).map(([id, generation]) => {
      const { token: _token, ...visible } = generation
      return [id, visible]
    })),
  }
}

async function run(command, args, options = {}) {
  let executable = command
  let commandArgs = args
  if (process.platform === 'win32' && command === 'pnpm') {
    const { stdout } = await execFileAsync('where.exe', ['pnpm.cmd'], { windowsHide: true })
    const shim = stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean)
    if (shim === undefined) throw new Error('Could not locate pnpm.cmd')
    const cli = join(dirname(shim), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    if (!existsSync(cli)) throw new Error(`Could not locate the pnpm CLI behind ${shim}`)
    executable = process.execPath
    commandArgs = [cli, ...args]
  }
  try {
    const result = await execFileAsync(executable, commandArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (error) {
    const output = [error?.stdout, error?.stderr].map(value => String(value ?? '').trim()).filter(Boolean).join('\n')
    if (!output) throw error
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`, { cause: error })
  }
}

function generationId(number) {
  return `g${String(number).padStart(4, '0')}`
}

function composeEnvironment(state, generation) {
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: generation.composeProject,
    SELF_EVOLVE_HOST_PORT: String(generation.port),
    SELF_EVOLVE_WORKSPACE: generation.workspace,
    SELF_EVOLVE_CONTROL_ROOT: join(state.stateDirectory, 'control'),
    SELF_EVOLVE_REPOSITORY: state.repository,
    SELF_EVOLVE_GENERATION: generation.id,
    SELF_EVOLVE_TEAM_CONFIG: generation.teamConfigPath,
    FLEET_PACKAGE_PATH: generation.packagePath,
    FLEET_PATCHOULI_PACKAGE_PATH: generation.patchouliPackagePath,
    FLEET_SOURCE_COMMIT: generation.sourceCommit,
    FLEET_AUTO_BOOTSTRAP_ID: generation.id,
    SELF_EVOLVE_CPUS: String(state.resources.cpus),
    SELF_EVOLVE_MEMORY: state.resources.memory,
    ...(state.provider === undefined ? {} : { FLEET_AUTO_PROVIDER: state.provider }),
    ...(state.model === undefined ? {} : { FLEET_AUTO_MODEL: state.model }),
  }
}

async function emit(stateDirectory, state, generationIdValue, type, data = {}) {
  const sequence = (state.eventSequences[generationIdValue] ?? 0) + 1
  state.eventSequences[generationIdValue] = sequence
  const event = {
    sequence,
    generation: generationIdValue,
    type,
    createdAt: new Date().toISOString(),
    data,
  }
  const directory = join(stateDirectory, 'control', 'events', generationIdValue)
  mkdirSync(directory, { recursive: true })
  atomicJson(join(directory, `${String(sequence).padStart(10, '0')}-${randomUUID()}.json`), event)
  writeState(stateDirectory, state)
  return event
}

async function resolveCommit(sourceRoot, ref) {
  const { stdout } = await run('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: sourceRoot })
  return stdout
}

async function recordGenerationCommit(state, sourceWorkspace, generationIdValue, sourceCommit) {
  const branch = `generations/${generationIdValue}`
  await run('git', [
    'push', state.repository,
    `${sourceCommit}:refs/heads/${branch}`,
  ], { cwd: sourceWorkspace })
  return branch
}

async function prepareGeneration(state, number, sourceRef, bootstrapContent, options = {}) {
  const id = generationId(number)
  const generationRoot = join(state.stateDirectory, 'generations', id)
  const workspace = join(generationRoot, 'workspace')
  if (existsSync(workspace)) throw new Error(`Generation workspace already exists: ${workspace}`)
  const inheritedTeamConfigPath = options.parent === undefined
    ? join(state.exampleRoot, 'team.local.json')
    : state.generations[options.parent].teamConfigPath
  const teamConfigContent = validateJsonDocument(
    options.teamConfigContent ?? readFileSync(inheritedTeamConfigPath, 'utf8'),
    options.teamConfigContent === undefined
      ? `inherited team configuration ${inheritedTeamConfigPath}`
      : 'candidate team configuration',
  )
  const sourceWorkspace = options.sourceWorkspace ?? state.sourceRoot
  const sourceCommit = await resolveCommit(sourceWorkspace, sourceRef)
  mkdirSync(generationRoot, { recursive: true })
  const gitBranch = await recordGenerationCommit(state, sourceWorkspace, id, sourceCommit)
  await run('git', [
    'clone', '--no-hardlinks', '--branch', gitBranch,
    state.repository, workspace,
  ], { cwd: generationRoot })
  try {
    await run('git', ['remote', 'set-url', 'origin', '/repository'], { cwd: workspace })
    await run('git', ['config', 'user.name', `Fleet ${id}`], { cwd: workspace })
    await run('git', ['config', 'user.email', `${id}@fleet.local`], { cwd: workspace })
    await run('git', ['config', 'core.autocrlf', 'true'], { cwd: workspace })
    const excludePath = join(workspace, '.git', 'info', 'exclude')
    writeFileSync(excludePath, `${readFileSync(excludePath, 'utf8')}\n.self-evolve/\n`, 'utf8')
    await run('pnpm', ['install', '--frozen-lockfile'], { cwd: workspace })
    await run('pnpm', ['build'], { cwd: workspace })
    await run('git', ['add', '-u'], { cwd: workspace })
    await run('git', ['diff', '--cached', '--exit-code', '--stat'], { cwd: workspace })
    mkdirSync(join(generationRoot, 'packages'), { recursive: true })
    await run('pnpm', ['pack', '--pack-destination', join(generationRoot, 'packages')], { cwd: workspace })
    await run('pnpm', [
      '--filter', 'dsh-agent-fleet-patchouli',
      'pack', '--pack-destination', join(generationRoot, 'packages'),
    ], { cwd: workspace })
    const packageDirectory = join(generationRoot, 'packages')
    const packageNames = readdirSync(packageDirectory).filter(name => name.endsWith('.tgz'))
    const packageName = packageNames.find(name => /^dsh-agent-fleet-\d/.test(name))
    const patchouliPackageName = packageNames.find(name => name.startsWith('dsh-agent-fleet-patchouli-'))
    if (packageName === undefined) throw new Error('pnpm pack did not produce a Fleet package')
    if (patchouliPackageName === undefined) throw new Error('pnpm pack did not produce a Fleet Patchouli package')
    const bootstrapDirectory = join(workspace, '.self-evolve')
    mkdirSync(bootstrapDirectory, { recursive: true })
    const bootstrapPath = join(bootstrapDirectory, 'bootstrap.md')
    const teamConfigPath = join(bootstrapDirectory, 'team.local.json')
    const role = options.parent === undefined ? 'stable' : 'candidate'
    const createdAt = new Date().toISOString()
    writeFileSync(bootstrapPath, [
      stripHostGenerationFooter(bootstrapContent),
      '',
      HOST_GENERATION_MARKER,
      '',
      '## 宿主代际信息',
      '',
      `- 当前代：${id}`,
      `- 源提交：${sourceCommit}`,
      `- 控制命令：node /opt/self-evolve/scripts/generation-control.mjs`,
      '- 可以在候选 bootstrap 中改进下一代的工作方式；如需调整角色或团队提示词，复制并修改 `.self-evolve/team.local.json`，再向 `start-candidate` 传入 `--team-config <absolute-file>`。',
      '- 等待状态变化请使用 `watch`；它会阻塞直到事件到达，不要按时间轮询。',
      '',
    ].join('\n'), 'utf8')
    const token = randomBytes(32).toString('hex')
    writeFileSync(teamConfigPath, teamConfigContent, 'utf8')
    writeFileSync(join(bootstrapDirectory, 'control-token'), `${token}\n`, 'utf8')
    const generation = {
      id,
      number,
      parent: options.parent ?? null,
      sourceRef,
      sourceCommit,
      gitBranch,
      workspace,
      packagePath: join(packageDirectory, packageName),
      patchouliPackagePath: join(packageDirectory, patchouliPackageName),
      bootstrapPath,
      teamConfigPath,
      composeProject: `${state.name}-${id}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
      port: state.basePort + number - 1,
      token,
      phase: 'starting',
      createdAt,
    }
    writeGenerationManifest(generation, role)
    return generation
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}

function generationVolume(generation, suffix) {
  return `${generation.composeProject}_${suffix}`
}

async function prepareLinuxWorkspace(state, generation) {
  const volume = generationVolume(generation, 'workspace-node-modules')
  await run('docker', [
    'run', '--rm', '--pull', 'never',
    '--entrypoint', 'pnpm',
    '--workdir', '/workspace',
    '--volume', `${generation.workspace}:/workspace`,
    '--volume', `${volume}:/workspace/node_modules`,
    'local/dsh-agent-fleet-self-evolve:latest',
    'install', '--frozen-lockfile',
  ])
}

async function preparePatchouliData(state, generation) {
  const destination = generationVolume(generation, 'patchouli-data')
  if (generation.parent === null) return
  const parent = state.generations[generation.parent]
  if (parent === undefined) return
  const source = generationVolume(parent, 'patchouli-data')
  const present = await run('docker', ['volume', 'inspect', source]).then(() => true, () => false)
  if (!present) return
  const checkpointed = await compose(state, parent, [
    'exec', '-T', 'dsh',
    '/root/.patchouli/bin/v0.1.6/patchouli-db',
    'checkpoint', '--endpoint', '/data/.patchouli/run/patchouli.sock',
  ]).then(() => true, () => false)
  if (!checkpointed) {
    generation.memoryInheritance = {
      status: 'skipped',
      reason: `Patchouli checkpoint was unavailable in ${parent.id}`,
      createdAt: new Date().toISOString(),
    }
    return
  }
  let paused = false
  try {
    await compose(state, parent, ['pause'])
    paused = true
    await run('docker', [
      'run', '--rm', '--pull', 'never',
      '--entrypoint', 'sh',
      '--volume', `${source}:/source:ro`,
      '--volume', `${destination}:/destination`,
      'local/dsh-agent-fleet-self-evolve:latest',
      '-lc', 'cp -a /source/. /destination/',
    ])
    generation.memoryInheritance = {
      status: 'copied',
      from: parent.id,
      createdAt: new Date().toISOString(),
    }
  } finally {
    if (paused) await compose(state, parent, ['unpause'])
  }
}

async function compose(state, generation, args) {
  return run('docker', [
    'compose',
    '--project-directory', state.exampleRoot,
    '-f', join(state.exampleRoot, 'compose.yaml'),
    '-f', join(state.exampleRoot, 'compose.source.yaml'),
    ...args,
  ], { cwd: state.exampleRoot, env: composeEnvironment(state, generation) })
}

async function captureGenerationLogs(state, generation) {
  if (generation.runtimeLog !== undefined && existsSync(generation.runtimeLog)) return
  const path = join(dirname(generation.workspace), 'runtime.log')
  const result = await compose(state, generation, ['logs', '--no-color', '--timestamps']).catch(error => ({
    stdout: '',
    stderr: `Could not capture Compose logs: ${error instanceof Error ? error.message : String(error)}`,
  }))
  writeFileSync(path, [result.stdout, result.stderr].filter(Boolean).join('\n'), 'utf8')
  generation.runtimeLog = path
}

async function archiveGenerationContext(state, generation) {
  if (generation.contextArchive?.path !== undefined && existsSync(generation.contextArchive.path)) return
  const archiveDirectory = join(dirname(generation.workspace), 'archive')
  mkdirSync(archiveDirectory, { recursive: true })
  const finalPath = join(archiveDirectory, 'dsh-context.tar.gz')
  const temporaryName = `dsh-context-${randomUUID()}.partial.tar.gz`
  const temporaryPath = join(archiveDirectory, temporaryName)
  const volume = `${generation.composeProject}_dsh-data`
  try {
    await run('docker', [
      'run', '--rm', '--pull', 'never',
      '--entrypoint', 'tar',
      '--volume', `${volume}:/source:ro`,
      '--volume', `${archiveDirectory}:/archive`,
      'local/dsh-agent-fleet-self-evolve:latest',
      '-czf', `/archive/${temporaryName}`,
      '-C', '/source',
      '--exclude=.dsh/profiles',
      '--exclude=.dsh/node_modules',
      '.',
    ])
    renameSync(temporaryPath, finalPath)
  } catch (error) {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true })
    throw error
  }
  generation.contextArchive = {
    path: finalPath,
    createdAt: new Date().toISOString(),
    bytes: statSync(finalPath).size,
    excludes: ['.dsh/profiles', '.dsh/node_modules'],
  }

  const memoryFinalPath = join(archiveDirectory, 'patchouli-memory.tar.gz')
  const memoryTemporaryName = `patchouli-memory-${randomUUID()}.partial.tar.gz`
  const memoryTemporaryPath = join(archiveDirectory, memoryTemporaryName)
  const memoryVolume = generationVolume(generation, 'patchouli-data')
  try {
    await run('docker', [
      'run', '--rm', '--pull', 'never',
      '--entrypoint', 'tar',
      '--volume', `${memoryVolume}:/source:ro`,
      '--volume', `${archiveDirectory}:/archive`,
      'local/dsh-agent-fleet-self-evolve:latest',
      '-czf', `/archive/${memoryTemporaryName}`,
      '-C', '/source',
      '.',
    ])
    renameSync(memoryTemporaryPath, memoryFinalPath)
    generation.memoryArchive = {
      path: memoryFinalPath,
      createdAt: new Date().toISOString(),
      bytes: statSync(memoryFinalPath).size,
    }
  } catch (error) {
    if (existsSync(memoryTemporaryPath)) rmSync(memoryTemporaryPath, { force: true })
    throw error
  }
}

async function suspendGeneration(state, generation) {
  await compose(state, generation, [
    'exec', '-T', 'dsh',
    '/root/.patchouli/bin/v0.1.6/patchouli-db',
    'checkpoint', '--endpoint', '/data/.patchouli/run/patchouli.sock',
  ])
  await compose(state, generation, ['pause'])
  generation.suspendedAt = new Date().toISOString()
}

async function resumeGeneration(state, generation) {
  await compose(state, generation, ['unpause'])
  generation.resumedAt = new Date().toISOString()
  delete generation.suspendedAt
}

async function monitorGeneration(stateDirectory, state, generation) {
  if (generationMonitors.has(generation.id)) return
  const { stdout } = await compose(state, generation, ['ps', '-q', 'dsh'])
  const containerId = stdout.trim()
  if (!containerId) return
  const child = spawn('docker', ['wait', containerId], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let waitOutput = ''
  child.stdout.on('data', chunk => { waitOutput += String(chunk) })
  generationMonitors.set(generation.id, child)
  child.once('close', async waitProcessCode => {
    generationMonitors.delete(generation.id)
    try {
      const current = readState(stateDirectory)
      const stopped = current.generations[generation.id]
      if (stopped === undefined || ['retiring', 'retirement_failed', 'retired', 'rejecting', 'rejected', 'failed'].includes(stopped.phase)) return
      const reportedExitCode = Number(waitOutput.trim().split(/\s+/).at(-1))
      const exitCode = Number.isInteger(reportedExitCode) ? reportedExitCode : waitProcessCode
      const stoppedRole = current.stable === stopped.id
        ? 'stable'
        : current.guardian === stopped.id
          ? 'guardian'
          : current.candidate === stopped.id
            ? 'candidate'
            : 'generation'
      stopped.phase = 'failed'
      stopped.failure = `DSH container exited with code ${exitCode ?? 'unknown'}`
      writeState(stateDirectory, current)
      await emit(stateDirectory, current, stopped.id, 'generation.exited', { exitCode, role: stoppedRole })
      if (stoppedRole === 'stable' && current.guardian !== null && current.guardian !== undefined) {
        const guardian = current.generations[current.guardian]
        const orphanedCandidate = current.candidate === null ? undefined : current.generations[current.candidate]
        if (orphanedCandidate !== undefined) {
          orphanedCandidate.phase = 'rejecting'
        }
        await resumeGeneration(current, guardian)
        guardian.phase = 'stable'
        guardian.recoveredAt = new Date().toISOString()
        guardian.recoveredFrom = stopped.id
        current.stable = guardian.id
        current.guardian = null
        current.candidate = null
        writeGenerationManifest(guardian, 'stable')
        writeState(stateDirectory, current)
        await emit(stateDirectory, current, guardian.id, 'generation.recovered', {
          failed: stopped.id,
          discardedCandidate: orphanedCandidate?.id,
        })
        if (orphanedCandidate !== undefined) {
          await stopGeneration(current, orphanedCandidate, { removeVolumes: true }).catch(() => undefined)
          orphanedCandidate.phase = 'rejected'
          orphanedCandidate.reason = `Parent stable generation ${stopped.id} exited`
          writeState(stateDirectory, current)
        }
      } else if (stoppedRole === 'guardian') {
        current.guardian = null
        writeState(stateDirectory, current)
        await emit(stateDirectory, current, current.stable, 'guardian.exited', {
          guardian: stopped.id,
          exitCode,
        })
      } else {
        const peer = stoppedRole === 'candidate' ? current.stable : null
        if (peer !== null && peer !== stopped.id) {
          await emit(stateDirectory, current, peer, 'generation.peer_exited', {
            generation: stopped.id, exitCode,
          })
        }
      }
      await captureGenerationLogs(current, stopped)
      await stopGeneration(current, stopped, { removeVolumes: true })
      writeState(stateDirectory, current)
      await cleanupOldGenerations(stateDirectory, current)
    } catch (error) {
      process.stderr.write(`generation monitor failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  })
}

async function launchGeneration(stateDirectory, state, generation, options = {}) {
  state.generations[generation.id] = generation
  state.eventSequences[generation.id] ??= 0
  writeState(stateDirectory, state)
  try {
    await compose(state, generation, ['build'])
    await compose(state, generation, ['create'])
    await prepareLinuxWorkspace(state, generation)
    await preparePatchouliData(state, generation)
    await compose(state, generation, ['up', '-d', '--no-build', '--wait'])
    generation.phase = 'observing'
    writeState(stateDirectory, state)
    if (options.monitor !== false) await monitorGeneration(stateDirectory, state, generation)
    return generation
  } catch (error) {
    generation.phase = 'failed'
    generation.failure = error instanceof Error ? error.message : String(error)
    await captureGenerationLogs(state, generation)
    await stopGeneration(state, generation, { removeVolumes: true }).catch(() => undefined)
    writeState(stateDirectory, state)
    throw error
  }
}

async function stopGeneration(state, generation, { removeVolumes = false, archiveContext = removeVolumes } = {}) {
  if (archiveContext) {
    await captureGenerationLogs(state, generation)
    if (generation.suspendedAt === undefined) {
      await compose(state, generation, ['stop', '--timeout', '30'])
      await archiveGenerationContext(state, generation)
    } else {
      await archiveGenerationContext(state, generation)
      await compose(state, generation, ['kill']).catch(() => undefined)
    }
  }
  await compose(state, generation, [
    'down',
    '--remove-orphans',
    ...(removeVolumes ? ['--volumes'] : []),
  ])
  generation.stoppedAt = new Date().toISOString()
}

function assertManagedWorkspace(state, workspace) {
  const managedRoot = resolve(state.stateDirectory, 'generations')
  const target = resolve(workspace)
  if (target === managedRoot || !target.startsWith(`${managedRoot}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Refusing to clean unmanaged worktree ${target}`)
  }
  return target
}

async function cleanupOldGenerations(stateDirectory, state) {
  for (const generation of Object.values(state.generations).filter(candidate => candidate.phase === 'retirement_failed')) {
    try {
      await stopGeneration(state, generation, { removeVolumes: true })
      generation.phase = 'retired'
      generation.retiredAt = new Date().toISOString()
      delete generation.retirementFailure
      writeState(stateDirectory, state)
    } catch (error) {
      generation.retirementFailure = error instanceof Error ? error.message : String(error)
      writeState(stateDirectory, state)
    }
  }
  const keep = state.retention?.generations ?? 2
  const inactive = Object.values(state.generations)
    .filter(generation => ['retired', 'rejected', 'failed'].includes(generation.phase) && generation.cleanedAt === undefined)
    .sort((left, right) => right.number - left.number)
  for (const generation of inactive.slice(keep)) {
    for (const suffix of ['dsh-data', 'patchouli-data', 'workspace-node-modules']) {
      await run('docker', ['volume', 'rm', generationVolume(generation, suffix)]).catch(() => undefined)
    }
    try {
      const workspace = assertManagedWorkspace(state, generation.workspace)
      const generationRoot = dirname(workspace)
      if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
      const packages = join(generationRoot, 'packages')
      if (existsSync(packages)) rmSync(packages, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
      generation.cleanedAt = new Date().toISOString()
      delete generation.cleanupFailure
    } catch (error) {
      generation.cleanupFailure = error instanceof Error ? error.message : String(error)
    }
    writeState(stateDirectory, state)
  }
}

async function startCandidate(stateDirectory, state, request) {
  const payload = request.payload ?? {}
  const sourceRef = requiredText(payload.sourceRef, 'candidate sourceRef')
  const bootstrap = payload.bootstrap?.content
  const bootstrapContent = requiredText(bootstrap, 'candidate bootstrap content')
  let candidate = state.candidate === null ? undefined : state.generations[state.candidate]
  if (candidate === undefined) {
    const number = state.nextGeneration
    state.nextGeneration += 1
    candidate = await prepareGeneration(state, number, sourceRef, bootstrapContent, {
      sourceWorkspace: state.generations[state.stable].workspace,
      parent: state.stable,
      ...(payload.teamConfig?.content === undefined
        ? {}
        : { teamConfigContent: requiredText(payload.teamConfig.content, 'candidate team config content') }),
    })
    candidate.requestId = request.id
    state.candidate = candidate.id
    writeState(stateDirectory, state)
  }
  if (candidate.phase === 'observing' || candidate.phase === 'ready') return
  try {
    await launchGeneration(stateDirectory, state, candidate)
    await emit(stateDirectory, state, state.stable, 'candidate.started', {
      candidate: candidate.id,
      sourceCommit: candidate.sourceCommit,
      port: candidate.port,
    })
    await emit(stateDirectory, state, candidate.id, 'generation.started', {
      role: 'candidate',
      parent: state.stable,
      sourceCommit: candidate.sourceCommit,
      port: candidate.port,
    })
  } catch (error) {
    await emit(stateDirectory, state, state.stable, 'candidate.failed', {
      candidate: candidate.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function destroyCandidate(stateDirectory, state, request, kind = 'candidate.destroyed') {
  const candidate = state.generations[state.candidate]
  candidate.phase = 'rejecting'
  writeState(stateDirectory, state)
  await stopGeneration(state, candidate, { removeVolumes: true })
  candidate.phase = 'rejected'
  candidate.reason = request.payload?.reason ?? kind
  state.candidate = null
  await emit(stateDirectory, state, state.stable, kind, {
    candidate: candidate.id,
    reason: candidate.reason,
  })
  await cleanupOldGenerations(stateDirectory, state)
}

function persistInheritedHandoff(previous, candidate, payload = {}) {
  const directory = join(candidate.workspace, '.self-evolve', 'inherited')
  mkdirSync(directory, { recursive: true })
  const name = `${previous.id}-handoff.md`
  const path = join(directory, name)
  const supplied = typeof payload.handoff?.content === 'string' ? payload.handoff.content.trim() : ''
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
  const content = supplied || [
    `# ${previous.id} → ${candidate.id} 代际托付`,
    '',
    summary || '上一代未提供额外交接正文；请结合 inherited.json、Git 历史和代际事件继续工作。',
    '',
  ].join('\n')
  writeFileSync(path, `${content}\n`, 'utf8')
  const inherited = {
    schemaVersion: 1,
    from: previous.id,
    to: candidate.id,
    promotedAt: candidate.promotedAt,
    sourceCommit: candidate.sourceCommit,
    handoffPath: `/workspace/.self-evolve/inherited/${name}`,
    ...(payload.handoff?.path === undefined ? {} : { sourceHandoffPath: payload.handoff.path }),
    summary,
  }
  atomicJson(join(directory, 'inherited.json'), inherited)
  candidate.inheritedHandoff = inherited
  return inherited
}

async function processRequest(stateDirectory, request) {
  const state = readState(stateDirectory)
  if (state.processedRequests.includes(request.id)) return
  const sender = state.generations[request.generation]
  if (sender === undefined || !verifyRequest(request, sender.token)) {
    throw new Error(`Rejected unauthenticated request ${request.id ?? '<unknown>'}`)
  }
  authorizeRequest(state, request)
  if (request.type === 'candidate.start') await startCandidate(stateDirectory, state, request)
  else if (request.type === 'candidate.destroy') await destroyCandidate(stateDirectory, state, request)
  else if (request.type === 'candidate.reject') await destroyCandidate(stateDirectory, state, request, 'candidate.self_rejected')
  else if (request.type === 'candidate.ready') {
    const candidate = state.generations[state.candidate]
    candidate.phase = 'ready'
    candidate.readiness = request.payload ?? {}
    writeState(stateDirectory, state)
    await emit(stateDirectory, state, state.stable, 'candidate.ready', {
      candidate: candidate.id,
      summary: request.payload?.summary ?? '',
      evidence: request.payload?.evidence,
    })
  } else if (request.type === 'generation.promote') {
    const previous = state.generations[state.stable]
    const candidate = state.generations[state.candidate]
    const previousGuardian = state.guardian
    const inheritedDirectory = join(candidate.workspace, '.self-evolve', 'inherited')
    const inheritedJsonPath = join(inheritedDirectory, 'inherited.json')
    const handoffPath = join(inheritedDirectory, `${previous.id}-handoff.md`)
    const inheritedJsonBefore = existsSync(inheritedJsonPath) ? readFileSync(inheritedJsonPath) : undefined
    const handoffBefore = existsSync(handoffPath) ? readFileSync(handoffPath) : undefined
    previous.phase = 'hibernating'
    writeState(stateDirectory, state)
    try {
      await suspendGeneration(state, previous)
    } catch (error) {
      previous.phase = 'stable'
      delete previous.suspendedAt
      writeState(stateDirectory, state)
      throw error
    }
    let inherited
    let advanced
    try {
      candidate.promotedAt = new Date().toISOString()
      candidate.handoff = request.payload ?? {}
      inherited = persistInheritedHandoff(previous, candidate, request.payload)
      advanced = advancePromotionWindow(state)
      writeGenerationManifest(previous, 'guardian')
      writeGenerationManifest(candidate, 'stable')
      writeState(stateDirectory, state)
    } catch (error) {
      state.stable = previous.id
      state.guardian = previousGuardian
      state.candidate = candidate.id
      previous.phase = 'stable'
      candidate.phase = 'ready'
      delete candidate.promotedAt
      delete candidate.handoff
      delete candidate.inheritedHandoff
      if (inheritedJsonBefore === undefined) rmSync(inheritedJsonPath, { force: true })
      else writeFileSync(inheritedJsonPath, inheritedJsonBefore)
      if (handoffBefore === undefined) rmSync(handoffPath, { force: true })
      else writeFileSync(handoffPath, handoffBefore)
      await resumeGeneration(state, previous)
      writeGenerationManifest(previous, 'stable')
      writeGenerationManifest(candidate, 'candidate')
      writeState(stateDirectory, state)
      throw error
    }
    await emit(stateDirectory, state, candidate.id, 'generation.promoted', {
      previous: previous.id,
      guardian: previous.id,
      retiredGuardian: advanced.retiredGuardian?.id,
      handoff: request.payload?.handoff,
      summary: request.payload?.summary ?? '',
      inherited,
    })
    const oldGuardian = advanced.retiredGuardian
    if (oldGuardian !== undefined) {
      oldGuardian.phase = 'retiring'
      writeState(stateDirectory, state)
      try {
        await stopGeneration(state, oldGuardian, { removeVolumes: true })
        oldGuardian.phase = 'retired'
        oldGuardian.retiredBy = candidate.id
        oldGuardian.retiredAt = new Date().toISOString()
        writeState(stateDirectory, state)
        await emit(stateDirectory, state, candidate.id, 'guardian.retired', {
          guardian: oldGuardian.id,
          replacement: previous.id,
        })
      } catch (error) {
        oldGuardian.phase = 'retirement_failed'
        oldGuardian.retirementFailure = error instanceof Error ? error.message : String(error)
        writeState(stateDirectory, state)
        await emit(stateDirectory, state, candidate.id, 'guardian.retirement_failed', {
          guardian: oldGuardian.id,
          replacement: previous.id,
          error: oldGuardian.retirementFailure,
        })
      }
    }
    await cleanupOldGenerations(stateDirectory, state)
  }
  const completed = readState(stateDirectory)
  if (!completed.processedRequests.includes(request.id)) completed.processedRequests.push(request.id)
  if (completed.processedRequests.length > 5000) completed.processedRequests.splice(0, 1000)
  writeState(stateDirectory, completed)
}

async function scanRequests(stateDirectory) {
  const requestDirectory = join(stateDirectory, 'control', 'requests')
  const completedDirectory = join(stateDirectory, 'control', 'completed')
  const rejectedDirectory = join(stateDirectory, 'control', 'rejected')
  mkdirSync(requestDirectory, { recursive: true })
  for (const name of readdirSync(requestDirectory).filter(name => name.endsWith('.json')).sort()) {
    const path = join(requestDirectory, name)
    let request
    try {
      request = JSON.parse(readFileSync(path, 'utf8'))
      await processRequest(stateDirectory, request)
      mkdirSync(completedDirectory, { recursive: true })
      renameSync(path, join(completedDirectory, name))
    } catch (error) {
      const state = readState(stateDirectory)
      if (request !== undefined && state.generations[request.generation] !== undefined) {
        await emit(stateDirectory, state, request.generation, 'request.rejected', {
          requestId: request.id,
          requestType: request.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      mkdirSync(rejectedDirectory, { recursive: true })
      renameSync(path, join(rejectedDirectory, name))
    }
  }
}

async function serve(stateDirectory) {
  const requestDirectory = join(stateDirectory, 'control', 'requests')
  mkdirSync(requestDirectory, { recursive: true })
  let active = false
  let rerun = false
  const drain = async () => {
    if (active) {
      rerun = true
      return
    }
    active = true
    try {
      do {
        rerun = false
        await scanRequests(stateDirectory)
      } while (rerun)
    } finally {
      active = false
    }
  }
  await drain()
  const state = readState(stateDirectory)
  if (state.status === 'stopped') return
  for (const generation of Object.values(state.generations)) {
    if (['stable', 'guardian', 'hibernating', 'observing', 'ready'].includes(generation.phase)) {
      await monitorGeneration(stateDirectory, state, generation)
    }
  }
  await cleanupOldGenerations(stateDirectory, state)
  process.stdout.write(`Self-evolution supervisor watching ${requestDirectory}\n`)
  await new Promise((resolvePromise, rejectPromise) => {
    const watcher = watch(requestDirectory, { persistent: true }, () => {
      void drain().then(() => {
        if (readState(stateDirectory).status === 'stopped') stop()
      }).catch(rejectPromise)
    })
    const stop = () => {
      watcher.close()
      resolvePromise()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

async function stopRun(stateDirectory) {
  const state = readState(stateDirectory)
  if (state.status === 'stopped') return state
  for (const generation of Object.values(state.generations).sort((left, right) => right.number - left.number)) {
    if (generation.cleanedAt !== undefined) continue
    generation.phase = 'retiring'
    writeState(stateDirectory, state)
    await stopGeneration(state, generation, { removeVolumes: true }).catch(() => undefined)
    generation.phase = 'stopped'
  }
  state.status = 'stopped'
  state.guardian = null
  state.candidate = null
  state.stoppedAt = new Date().toISOString()
  writeState(stateDirectory, state)
  writeFileSync(join(stateDirectory, 'control', 'requests', '.supervisor-stopped'), `${state.stoppedAt}\n`, 'utf8')
  return state
}

async function initialize(args) {
  const stateDirectory = requiredAbsolute(args.state, '--state')
  const sourceRoot = requiredAbsolute(args.source, '--source')
  const bootstrapPath = requiredAbsolute(args.bootstrap, '--bootstrap')
  const exampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (existsSync(join(stateDirectory, 'state.json'))) throw new Error(`State already exists: ${stateDirectory}`)
  if (!existsSync(bootstrapPath)) throw new Error(`Bootstrap file does not exist: ${bootstrapPath}`)
  const basePort = Number(args.port ?? 3120)
  const cpus = Number(args.cpus ?? 4)
  const retainGenerations = Number(args['retain-generations'] ?? 2)
  if (!Number.isSafeInteger(basePort) || basePort < 1024 || basePort > 65000) throw new Error('--port must be between 1024 and 65000')
  if (!Number.isFinite(cpus) || cpus <= 0) throw new Error('--cpus must be positive')
  if (!Number.isSafeInteger(retainGenerations) || retainGenerations < 0) {
    throw new Error('--retain-generations must be a non-negative integer')
  }
  mkdirSync(join(stateDirectory, 'control', 'requests'), { recursive: true })
  const repository = join(stateDirectory, 'repository.git')
  await run('git', ['clone', '--bare', '--no-hardlinks', sourceRoot, repository], { cwd: stateDirectory })
  const state = {
    schemaVersion: 3,
    name: requiredText(args.name ?? `self-evolve-${randomUUID().slice(0, 8)}`, '--name'),
    stateDirectory,
    sourceRoot,
    repository,
    exampleRoot,
    basePort,
    resources: { cpus, memory: requiredText(args.memory ?? '8g', '--memory') },
    retention: {
      generations: retainGenerations,
    },
    ...(args.provider === undefined ? {} : { provider: requiredText(args.provider, '--provider') }),
    ...(args.model === undefined ? {} : { model: requiredText(args.model, '--model') }),
    stable: generationId(1),
    guardian: null,
    candidate: null,
    nextGeneration: 2,
    generations: {},
    eventSequences: {},
    processedRequests: [],
    status: 'running',
  }
  const generation = await prepareGeneration(
    state,
    1,
    requiredText(args.ref ?? 'HEAD', '--ref'),
    readFileSync(bootstrapPath, 'utf8'),
  )
  generation.phase = 'stable'
  try {
    await launchGeneration(stateDirectory, state, generation, { monitor: args['no-serve'] !== true })
  } catch (error) {
    state.status = 'failed'
    state.failedAt = new Date().toISOString()
    writeState(stateDirectory, state)
    throw error
  }
  generation.phase = 'stable'
  writeState(stateDirectory, state)
  await emit(stateDirectory, state, generation.id, 'generation.started', {
    role: 'stable', sourceCommit: generation.sourceCommit, port: generation.port,
  })
  process.stdout.write(`${JSON.stringify({ state: stateDirectory, generation: generation.id, port: generation.port })}\n`)
  if (args.serve !== false && args['no-serve'] !== true) await serve(stateDirectory)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  if (command === 'init') return initialize(args)
  if (command === 'serve') return serve(requiredAbsolute(args.state, '--state'))
  if (command === 'stop') {
    const state = await stopRun(requiredAbsolute(args.state, '--state'))
    process.stdout.write(`${JSON.stringify(publicState(state), null, 2)}\n`)
    return
  }
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(publicState(readState(requiredAbsolute(args.state, '--state'))), null, 2)}\n`)
    return
  }
  throw new Error('Usage: supervisor <init|serve|status|stop> --state <absolute-directory> [options]')
}

main().catch(error => {
  process.stderr.write(`self-evolution supervisor: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})

export { processRequest, readState }
