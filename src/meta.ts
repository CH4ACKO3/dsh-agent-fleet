import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'

import type { FleetAssistantMode, FleetAssistantRuntime } from './assistant.js'

export interface FleetMetaAssistantServiceOptions {
  readonly directory?: string
}

/** Persist the small set of Sessions that belong to the workspace-free Fleet Help persona. */
export class FleetMetaAssistantService {
  private readonly directory: string

  constructor(
    private readonly assistant: FleetAssistantRuntime,
    options: FleetMetaAssistantServiceOptions = {},
  ) {
    const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    this.directory = options.directory ?? join(dshHome, 'dsh-agent-fleet', 'meta-assistants')
  }

  activate(agent: Agent): FleetAssistantMode {
    mkdirSync(this.directory, { recursive: true })
    writeFileSync(this.markerPath(String(agent.id)), 'fleet-meta-assistant\n', 'utf8')
    return this.assistant.activateMeta(agent)
  }

  restore(agent: Agent): FleetAssistantMode | undefined {
    if (!existsSync(this.markerPath(String(agent.id)))) return undefined
    return this.assistant.activateMeta(agent)
  }

  private markerPath(sessionId: string): string {
    const key = createHash('sha256').update(sessionId).digest('hex')
    return join(this.directory, `${key}.marker`)
  }
}
