import { spawn } from 'node:child_process'

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const FORBIDDEN_IDENTITY_ARGUMENTS = new Set(['--as', '--profile'])

export type FleetLarkCliIdentity = 'bot' | 'user'

export interface FleetLarkCliConfig {
  readonly executable?: string
  readonly profile?: string
  readonly maxOutputBytes?: number
}

export interface FleetLarkCommandOptions {
  readonly signal?: AbortSignal
  readonly stdin?: string | Uint8Array
}

export interface FleetLarkCommandResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

/** Build an identity-pinned lark-cli argv without permitting caller overrides. */
export function larkIdentityArgs(
  identity: FleetLarkCliIdentity,
  args: readonly string[],
  profile?: string,
): string[] {
  assertNoIdentityOverride(args)
  return [
    ...(profile === undefined || profile.length === 0 ? [] : ['--profile', profile]),
    ...args,
    '--as',
    identity,
  ]
}

export class FleetLarkCli {
  private readonly executable: string
  private readonly profile: string | undefined
  private readonly maxOutputBytes: number

  constructor(
    readonly identity: FleetLarkCliIdentity,
    config: FleetLarkCliConfig = {},
  ) {
    this.executable = config.executable ?? 'lark-cli'
    this.profile = config.profile
    this.maxOutputBytes = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 1) {
      throw new TypeError('lark-cli maxOutputBytes must be a positive safe integer')
    }
  }

  /** Execute an arbitrary lark-cli operation explicitly as this adapter's identity. */
  execute(args: readonly string[], options: FleetLarkCommandOptions = {}): Promise<FleetLarkCommandResult> {
    return this.run(larkIdentityArgs(this.identity, args, this.profile), options)
  }

  /** Inspect login state. Auth commands do not accept an --as identity selector. */
  authStatus(options: FleetLarkCommandOptions = {}): Promise<FleetLarkCommandResult> {
    const args = [
      ...(this.profile === undefined || this.profile.length === 0 ? [] : ['--profile', this.profile]),
      'auth',
      'status',
      '--json',
      '--verify',
    ]
    return this.run(args, options)
  }

  private run(args: readonly string[], options: FleetLarkCommandOptions): Promise<FleetLarkCommandResult> {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason)

    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LARK_CLI_DISABLE_NOTIFIER: '1',
          NO_UPDATE_NOTIFIER: '1',
        },
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let settled = false

      const finishError = (error: unknown): void => {
        if (settled) return
        settled = true
        child.kill()
        cleanup()
        reject(error)
      }
      const collect = (target: Buffer[], stream: 'stdout' | 'stderr', chunk: Buffer | string): void => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (stream === 'stdout') stdoutBytes += value.byteLength
        else stderrBytes += value.byteLength
        if (stdoutBytes > this.maxOutputBytes || stderrBytes > this.maxOutputBytes) {
          finishError(new Error(`lark-cli ${stream} exceeded ${this.maxOutputBytes} bytes`))
          return
        }
        target.push(value)
      }
      const abort = (): void => finishError(options.signal?.reason ?? new Error('lark-cli command aborted'))
      const cleanup = (): void => options.signal?.removeEventListener('abort', abort)

      options.signal?.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', chunk => collect(stdout, 'stdout', chunk))
      child.stderr.on('data', chunk => collect(stderr, 'stderr', chunk))
      child.once('error', finishError)
      child.once('close', (code, signal) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({
          code,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
      })

      child.stdin.end(options.stdin)
    })
  }
}

/** Compatibility name for code that only needs the user-authorized identity. */
export class FleetLarkUserCli extends FleetLarkCli {
  constructor(config: FleetLarkCliConfig = {}) {
    super('user', config)
  }
}

function assertNoIdentityOverride(args: readonly string[]): void {
  for (const arg of args) {
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg
    if (FORBIDDEN_IDENTITY_ARGUMENTS.has(name)) {
      throw new Error(`lark-cli argument ${name} is owned by Fleet Lark configuration`)
    }
  }
}
