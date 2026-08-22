export class HoverHintStack {
  readonly #open: string[] = []
  readonly #claimedDismissals = new WeakSet<object>()

  activate(id: string): void {
    this.deactivate(id)
    this.#open.push(id)
  }

  deactivate(id: string): void {
    const index = this.#open.indexOf(id)
    if (index !== -1) this.#open.splice(index, 1)
  }

  isTop(id: string): boolean {
    return this.#open.at(-1) === id
  }

  claimDismissal(id: string, event: object): boolean {
    if (!this.isTop(id) || this.#claimedDismissals.has(event)) return false
    this.#claimedDismissals.add(event)
    return true
  }
}
