/** Context maintenance preserves the task; only an explicit budget bounds work. */
export function contextCeilingDirectiveText(
  growthTokens: number,
  intervalTokens: number,
  afterCompaction = false,
): string {
  return [
    `[Fleet context checkpoint] Input context grew ${growthTokens} tokens across a ${intervalTokens}-token maintenance interval.`,
    'This is a context-maintenance checkpoint, not a task deadline or a notice that the Team budget is exhausted.',
    'Keep the current Work active. Briefly record established results, evidence paths, unresolved questions and the next useful action in its durable Task.',
    'Continue research, new searches, new Tasks and review/rework as needed within the actual configured time and token budgets; the assistant continues to author the DAG from the evidence.',
    afterCompaction ? 'Resume the same Work after compaction using its durable progress and pending input.' : 'Proceed with the next useful action; later context compaction must preserve this Work.',
  ].join(' ')
}
