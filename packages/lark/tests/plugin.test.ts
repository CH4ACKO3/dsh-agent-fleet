import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'

describe('Fleet Lark plugin', () => {
  it('provides both CLI identities without requiring realtime bot credentials', async () => {
    const ctx = new Context()
    apply(ctx, { cli: { executable: process.execPath } })

    expect(ctx.fleetLark.bot.identity).toBe('bot')
    expect(ctx.fleetLark.user.identity).toBe('user')
    const result = await ctx.fleetLark.bot.execute([
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      'payload',
    ])
    expect(JSON.parse(result.stdout)).toEqual(['payload', '--as', 'bot'])
  })
})
