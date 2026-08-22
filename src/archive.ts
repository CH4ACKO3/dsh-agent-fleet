import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface FleetArchiveTeam {
  readonly id: string
  readonly name: string
  readonly projectRoot: string
  readonly status: string
}

export interface FleetArchiveContributorContext {
  readonly team: FleetArchiveTeam
  readonly directory: string
}

export interface FleetArchiveRestoreContext extends FleetArchiveContributorContext {
  readonly sourceTeam: FleetArchiveTeam
  /** Source member Session id to imported member Session id. */
  readonly sessionIdMap: Readonly<Record<string, string>>
}

export interface FleetArchiveRestoreIdentity {
  readonly sourceTeam: FleetArchiveTeam
  readonly sessionIdMap: Readonly<Record<string, string>>
}

export interface FleetArchiveContributor {
  readonly id: string
  save(context: FleetArchiveContributorContext): Promise<void> | void
  restore(context: FleetArchiveRestoreContext): Promise<void> | void
}

export interface FleetArchiveRestoreReport {
  readonly missing: readonly string[]
  readonly failed: readonly { readonly id: string; readonly error: string }[]
}

const CONTRIBUTOR_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

export class FleetArchiveRegistry {
  private readonly contributors = new Map<string, FleetArchiveContributor>()

  register(contributor: FleetArchiveContributor): () => void {
    const id = contributor.id.trim()
    if (!CONTRIBUTOR_ID.test(id)) {
      throw new Error('Fleet archive contributor id must use lowercase letters, numbers, dots, dashes, or underscores')
    }
    if (this.contributors.has(id)) throw new Error(`Fleet archive contributor ${id} is already registered`)
    const registered = { ...contributor, id }
    this.contributors.set(id, registered)
    return () => {
      if (this.contributors.get(id) === registered) this.contributors.delete(id)
    }
  }

  ids(): string[] {
    return [...this.contributors.keys()].sort()
  }

  async save(team: FleetArchiveTeam, root: string): Promise<string[]> {
    for (const contributor of this.contributors.values()) {
      const directory = join(root, contributor.id)
      mkdirSync(directory, { recursive: true })
      await contributor.save({ team, directory })
    }
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && CONTRIBUTOR_ID.test(entry.name))
      .map(entry => entry.name)
      .sort()
  }

  async restore(
    team: FleetArchiveTeam,
    root: string,
    identity: FleetArchiveRestoreIdentity = { sourceTeam: team, sessionIdMap: {} },
  ): Promise<FleetArchiveRestoreReport> {
    const missing: string[] = []
    const failed: Array<{ readonly id: string; readonly error: string }> = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !CONTRIBUTOR_ID.test(entry.name)) continue
      const contributor = this.contributors.get(entry.name)
      if (contributor === undefined) {
        missing.push(entry.name)
        continue
      }
      try {
        await contributor.restore({
          team,
          directory: join(root, entry.name),
          sourceTeam: identity.sourceTeam,
          sessionIdMap: identity.sessionIdMap,
        })
      } catch (error) {
        failed.push({ id: entry.name, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { missing: missing.sort(), failed }
  }
}
