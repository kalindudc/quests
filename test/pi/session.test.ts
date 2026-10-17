import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { reconstructFromSession } from "../../extensions/pi/session.js";
import { InvalidQuestLogStateError, QuestLog } from "../../src/quest/dataplane.js";

function sessionWith(quests: unknown[]): ExtensionContext {
  const entries = [
    {
      type: "message",
      message: { role: "toolResult", toolName: "quest", details: { quests } },
    },
  ];
  return {
    sessionManager: { getBranch: vi.fn().mockReturnValue(entries) },
  } as unknown as ExtensionContext;
}

describe("reconstructFromSession", () => {
  it("reconstructs state from session branch", () => {
    const log = new QuestLog();
    reconstructFromSession(
      log,
      sessionWith([{ id: "01", description: "X", done: true, createdAt: 1 }]),
    );
    expect(log.getAll()).toEqual([{ id: "01", description: "X", done: true, createdAt: 1 }]);
  });

  it("splits quests with parentId into steps", () => {
    const log = new QuestLog();
    reconstructFromSession(
      log,
      sessionWith([
        { id: "01", description: "Parent", done: false, createdAt: 1 },
        { id: "02", description: "Sub", done: false, createdAt: 2, parentId: "01" },
      ]),
    );
    expect(log.getAll()).toHaveLength(2);
    expect(log.getSteps("01")).toHaveLength(1);
  });

  it("rejects quests saved with numeric ids and leaves the log unchanged", () => {
    const log = new QuestLog();
    log.add("Kept");

    expect(() =>
      reconstructFromSession(
        log,
        sessionWith([{ id: 1, description: "Old", done: false, createdAt: 1 }]),
      ),
    ).toThrow(InvalidQuestLogStateError);
    expect(log.getAll().map((quest) => quest.description)).toEqual(["Kept"]);
  });
});
