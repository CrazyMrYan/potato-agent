import type { RunTaskInput } from "@potato/protocol";

export type ContextBudgetSnapshot = {
  usedTokens: number;
  maxTokens: number;
  ratio: number;
};

export type ContextCompactionResult = {
  summary: string;
  originalTokens: number;
  compactedTokens: number;
};

export type ContextBudgetManager = {
  maxTokens: number;
  compactAtRatio: number;
  estimate(input: RunTaskInput): ContextBudgetSnapshot;
  compact(input: RunTaskInput, budget: ContextBudgetSnapshot): Promise<ContextCompactionResult>;
};

export class HeuristicContextBudgetManager implements ContextBudgetManager {
  constructor(
    readonly maxTokens: number = 120_000,
    readonly compactAtRatio: number = 0.75
  ) {}

  estimate(input: RunTaskInput): ContextBudgetSnapshot {
    const usedTokens = estimateTokens(input.prompt);
    return {
      usedTokens,
      maxTokens: this.maxTokens,
      ratio: this.maxTokens > 0 ? roundRatio(usedTokens / this.maxTokens) : 0
    };
  }

  async compact(input: RunTaskInput, budget: ContextBudgetSnapshot): Promise<ContextCompactionResult> {
    const summary = [
      `Task: ${input.prompt.trim()}`,
      `Workspace: ${input.workspacePath}`,
      "State: automatic context compaction was requested before continuing.",
      "Next: preserve task intent, key files, decisions, risks, and open work."
    ].join("\n");

    return {
      summary,
      originalTokens: budget.usedTokens,
      compactedTokens: estimateTokens(summary)
    };
  }
}

export function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  return Math.ceil(normalized.length / 4);
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}
