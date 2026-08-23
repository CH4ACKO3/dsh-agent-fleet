import { describe, expect, it } from 'vitest'
import { FleetLarkCli, FleetLarkUserCli, larkIdentityArgs } from '../src/user-cli.js'

describe('FleetLarkUserCli', () => {
  it('owns the identity and profile arguments', () => {
    expect(larkIdentityArgs('user', ['im', 'message', 'list'], 'school')).toEqual([
      '--profile',
      'school',
      'im',
      'message',
      'list',
      '--as',
      'user',
    ])
    expect(larkIdentityArgs('bot', ['docs', 'search'])).toEqual([
      'docs',
      'search',
      '--as',
      'bot',
    ])
    expect(() => larkIdentityArgs('user', ['whoami', '--as=bot'])).toThrow(/owned by Fleet Lark/u)
    expect(() => larkIdentityArgs('user', ['whoami', '--profile', 'other'])).toThrow(/owned by Fleet Lark/u)
  })

  it('pins bot commands independently from user commands', async () => {
    const cli = new FleetLarkCli('bot', { executable: process.execPath })
    const result = await cli.execute([
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      'payload',
    ])

    expect(JSON.parse(result.stdout)).toEqual(['payload', '--as', 'bot'])
  })

  it('spawns directly and appends explicit user identity', async () => {
    const cli = new FleetLarkUserCli({ executable: process.execPath })
    const result = await cli.execute([
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      'payload',
    ])

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['payload', '--as', 'user'])
  })

  it('returns nonzero results without auto-confirming or hiding stderr', async () => {
    const cli = new FleetLarkUserCli({ executable: process.execPath })
    const result = await cli.execute([
      '-e',
      'process.stderr.write("confirmation required"); process.exit(10)',
      'payload',
    ])

    expect(result.code).toBe(10)
    expect(result.stderr).toBe('confirmation required')
  })

  it('caps captured output', async () => {
    const cli = new FleetLarkUserCli({ executable: process.execPath, maxOutputBytes: 4 })
    await expect(cli.execute(['-e', 'process.stdout.write("12345")', 'payload'])).rejects.toThrow(/exceeded 4 bytes/u)
  })
})
