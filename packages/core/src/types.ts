import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-session'

export type FleetAgentStatus = 'idle' | 'running' | 'offline'

export interface RuntimeAgent {
  readonly id: string
  readonly status: 'idle' | 'running'
  readonly inbox?: {
    readonly nextTurn: readonly UserMessage[]
    readonly nextStep: readonly UserMessage[]
    clear(): void
  }
  cancel(cause: { readonly kind: 'user' | 'parent' }): void
  whenIdle(): Promise<void>
  inject(message: UserMessage): void
  followup(message: UserMessage): void
}

export interface RuntimeAgentHandle {
  readonly agent: RuntimeAgent
  dispose(): Promise<void>
}

export interface RotateRuntimeAgentInput {
  readonly archiveId: string
  readonly setup?: (ctx: Context) => void | Promise<void>
}

export interface CreateRuntimeAgentInput {
  readonly id: string
  readonly archiveId?: string
  readonly label: string
  readonly cwd?: string
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
  readonly persona?: string
  readonly setup?: (ctx: Context) => void | Promise<void>
}

export interface AgentRuntime {
  get(id: string): RuntimeAgent | undefined
  create(owner: RuntimeAgent, input: CreateRuntimeAgentInput): Promise<RuntimeAgentHandle>
  resume(owner: RuntimeAgent, input: ResumeRuntimeAgentInput): Promise<RuntimeAgentHandle>
  rotate?(handle: RuntimeAgentHandle, input: RotateRuntimeAgentInput): Promise<RuntimeAgentHandle | undefined>
}

export interface FleetAgent {
  readonly id: string
  readonly target: `@${string}`
  readonly name: string
  readonly displayName: string
  readonly color: string
  readonly role: string
  readonly capabilities: string[]
  readonly status: FleetAgentStatus
  readonly managed: boolean
  readonly createdBy?: string
  readonly registeredAt: string
}

export interface RegisterFleetAgentInput {
  readonly name: string
  readonly displayName?: string
  readonly color?: string
  readonly role: string
  readonly capabilities?: readonly string[]
}

export interface UpdateFleetAgentInput {
  readonly role?: string
  readonly capabilities?: readonly string[]
}

export interface CreateFleetAgentInput extends RegisterFleetAgentInput {
  readonly archiveId?: string
  readonly cwd?: string
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
  readonly persona?: string
  readonly setup?: (ctx: Context) => void | Promise<void>
}

export interface ResumeRuntimeAgentInput {
  readonly id: string
  readonly archiveId?: string
  readonly label: string
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
  readonly persona?: string
  readonly setup?: (ctx: Context) => void | Promise<void>
}

export interface ResumeFleetAgentInput extends CreateFleetAgentInput {
  readonly id: string
  readonly displayName: string
  readonly color: string
}
