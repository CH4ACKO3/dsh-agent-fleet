import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-presets'
import type { Session } from '@deepseek-ai/dsh-session'

/** Restore the latest recorded preset, including selections after session creation. */
export function resolveSessionPreset(session: Session): string | undefined {
  const projection = agentPresetProjectionDefinition
  return session.snapshotEvents().reduce(projection.apply, projection.init(session.header)) ?? undefined
}
