import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestUsageTracker } from "../../src/quest/tracker.js";

describe("QuestUsageTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an empty stats snapshot", () => {
    const tracker = new QuestUsageTracker();

    expect(tracker.hasUsedQuestTool).toBe(false);
    expect(tracker.getStats()).toEqual({
      totalToolCalls: 0,
      questToolCalls: 0,
      nonQuestToolCalls: 0,
      consecutiveNonQuestToolCalls: 0,
      hasUsedQuestTool: false,
      lastQuestToolTimestamp: undefined,
    });
  });

  it("counts non-quest tool calls and consecutive non-quest tool calls", () => {
    const tracker = new QuestUsageTracker();

    tracker.onToolExecution("read");
    tracker.onToolExecution("bash");

    expect(tracker.getStats()).toEqual({
      totalToolCalls: 2,
      questToolCalls: 0,
      nonQuestToolCalls: 2,
      consecutiveNonQuestToolCalls: 2,
      hasUsedQuestTool: false,
      lastQuestToolTimestamp: undefined,
    });
  });

  it("counts quest tool calls, resets consecutive non-quest calls, and stores the timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    const tracker = new QuestUsageTracker();

    tracker.onToolExecution("read");
    tracker.onToolExecution("quest");

    expect(tracker.hasUsedQuestTool).toBe(true);
    expect(tracker.getStats()).toEqual({
      totalToolCalls: 2,
      questToolCalls: 1,
      nonQuestToolCalls: 1,
      consecutiveNonQuestToolCalls: 0,
      hasUsedQuestTool: true,
      lastQuestToolTimestamp: Date.now(),
    });
  });

  it("starts a new consecutive non-quest streak after quest tool use", () => {
    const tracker = new QuestUsageTracker();

    tracker.onToolExecution("read");
    tracker.onToolExecution("quest");
    tracker.onToolExecution("edit");
    tracker.onToolExecution("write");

    expect(tracker.getStats()).toMatchObject({
      totalToolCalls: 4,
      questToolCalls: 1,
      nonQuestToolCalls: 3,
      consecutiveNonQuestToolCalls: 2,
      hasUsedQuestTool: true,
    });
  });

  it("markQuestToolUsed seeds quest usage without incrementing tool counters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T13:00:00.000Z"));
    const tracker = new QuestUsageTracker();

    tracker.markQuestToolUsed();

    expect(tracker.hasUsedQuestTool).toBe(true);
    expect(tracker.getStats()).toEqual({
      totalToolCalls: 0,
      questToolCalls: 0,
      nonQuestToolCalls: 0,
      consecutiveNonQuestToolCalls: 0,
      hasUsedQuestTool: true,
      lastQuestToolTimestamp: Date.now(),
    });
  });

  it("returns snapshots that do not change after later tool calls", () => {
    const tracker = new QuestUsageTracker();

    const before = tracker.getStats();
    tracker.onToolExecution("read");

    expect(before).toEqual({
      totalToolCalls: 0,
      questToolCalls: 0,
      nonQuestToolCalls: 0,
      consecutiveNonQuestToolCalls: 0,
      hasUsedQuestTool: false,
      lastQuestToolTimestamp: undefined,
    });
    expect(tracker.getStats().totalToolCalls).toBe(1);
  });
});
