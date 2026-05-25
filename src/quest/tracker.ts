export interface QuestUsageStats {
  readonly totalToolCalls: number;
  readonly questToolCalls: number;
  readonly nonQuestToolCalls: number;
  readonly consecutiveNonQuestToolCalls: number;
  readonly hasUsedQuestTool: boolean;
  readonly lastQuestToolTimestamp: number | undefined;
}

export class QuestUsageTracker {
  private totalToolCalls = 0;
  private questToolCalls = 0;
  private nonQuestToolCalls = 0;
  private consecutiveNonQuestToolCalls = 0;
  private hasEverUsedQuestTool = false;
  private lastQuestToolTimestamp: number | undefined;

  onToolExecution(toolName: string): void {
    this.totalToolCalls++;
    if (toolName === "quest") {
      this.questToolCalls++;
      this.hasEverUsedQuestTool = true;
      this.lastQuestToolTimestamp = Date.now();
      this.consecutiveNonQuestToolCalls = 0;
      return;
    }

    this.nonQuestToolCalls++;
    this.consecutiveNonQuestToolCalls++;
  }

  get hasUsedQuestTool(): boolean {
    return this.hasEverUsedQuestTool;
  }

  markQuestToolUsed(): void {
    this.hasEverUsedQuestTool = true;
    this.lastQuestToolTimestamp = Date.now();
  }

  getStats(): QuestUsageStats {
    return {
      totalToolCalls: this.totalToolCalls,
      questToolCalls: this.questToolCalls,
      nonQuestToolCalls: this.nonQuestToolCalls,
      consecutiveNonQuestToolCalls: this.consecutiveNonQuestToolCalls,
      hasUsedQuestTool: this.hasEverUsedQuestTool,
      lastQuestToolTimestamp: this.lastQuestToolTimestamp,
    };
  }
}
