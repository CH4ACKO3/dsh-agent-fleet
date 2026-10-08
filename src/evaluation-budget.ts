function record(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`)
  return value as Record<string, unknown>
}

/** Bind every member's shared context to the same host-owned evaluation clock. */
export function bindEvaluationBudget(team: unknown, timeoutMs: number, startedAt: string): {
  team: Record<string, unknown>
  instruction: string
  deadlineAt: string
} {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Evaluation timeout must be positive milliseconds')
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) throw new Error('Evaluation start must be a valid timestamp')
  const deadlineAt = new Date(started + timeoutMs).toISOString()
  const instruction = [
    `[Host evaluation budget] This episode has ${timeoutMs / 60000} minutes (${timeoutMs} ms) total, including bootstrap, research, rework and final integration.`,
    `The host clock started at ${startedAt}; its deadline is ${deadlineAt}. Use the current clock to determine remaining time.`,
    'This host configuration overrides any generic budget example in the team template. Reserve an appropriate integration and review window within the actual remaining time.',
    'A context checkpoint or a rejected review is not the deadline. The assistant chooses follow-up work from the evidence; do not invent a shorter episode budget.',
    'A root Work must stay actionable until it ends; only the host/operator can pause the whole Work. Preserve partial answers and report an unsuccessful result honestly when no useful continuation remains.',
  ].join(' ')
  const source = record(team, 'Team configuration')
  const modules = record(source.modules, 'Team modules')
  const messages = record(modules['dsh-agent-fleet/message'], 'Message configuration')
  if (messages.rules !== undefined && typeof messages.rules !== 'string') throw new Error('Team message rules must be text')
  return { deadlineAt, instruction, team: { ...source, modules: { ...modules,
    'dsh-agent-fleet/message': { ...messages, rules: [messages.rules, instruction].filter(Boolean).join('\n\n') },
  } } }
}
