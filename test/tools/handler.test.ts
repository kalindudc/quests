import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { QuestLog } from "../../src/quest/dataplane.js";
import { QUEST_ACTIONS } from "../../src/quest/types.js";
import { questToolExecute, registerQuestTool } from "../../src/tools/handler.js";

function getText(content: { type: "text"; text: string } | { type: "image" }): string | undefined {
  return content.type === "text" ? content.text : undefined;
}

let randomCall = 0;
beforeEach(() => {
  randomCall = 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    randomCall++;
    return randomCall / 256;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("questToolExecute", () => {
  function createLog() {
    return new QuestLog();
  }

  it("adds a quest", async () => {
    const log = createLog();
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.add,
      descriptions: ["Test"],
    });
    expect(result.content[0]).toEqual(
      expect.objectContaining({ text: expect.stringContaining("Added quest [01]: Test") }),
    );
  });

  it("splits a quest into a step", async () => {
    const log = createLog();
    log.add("Parent");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.split,
      id: "01",
      descriptions: ["Sub"],
    });
    expect(getText(result.content[0]!)).toContain("Split quest [01] into 1 steps");
    const details = result.details as { quests: unknown[] };
    expect(details.quests).toHaveLength(2);
  });

  it("add_step is an alias for split", async () => {
    const log = createLog();
    log.add("Parent");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.add_step,
      id: "01",
      descriptions: ["Sub"],
    });
    expect(getText(result.content[0]!)).toContain("Split quest [01] into 1 steps");
    const details = result.details as { quests: unknown[] };
    expect(details.quests).toHaveLength(2);
  });

  it("adds multiple quests in batch", async () => {
    const log = createLog();
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.add,
      descriptions: ["A", "B"],
    });
    expect(getText(result.content[0]!)).toContain("Added 2 quests");
    expect(log.getAll()).toHaveLength(2);
  });

  it("lists quests", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.list });
    expect(getText(result.content[0]!)).toContain("A");
  });

  it("toggles a quest", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.toggle, id: "01" });
    expect(getText(result.content[0]!)).toContain("Quest [01] done");
  });

  it("toggles multiple tasks", async () => {
    const log = createLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.toggle,
      ids: ["01", "02"],
    });
    expect(getText(result.content[0]!)).toContain("Toggled 2 tasks");
    expect(log.getAll().every((quest) => quest.done)).toBe(true);
  });

  it("clears quests", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.clear, all: true });
    expect(getText(result.content[0]!)).toContain("Cleared 1");
  });

  it("updates a quest", async () => {
    const log = createLog();
    log.add("Old");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.update,
      id: "01",
      description: "New",
    });
    expect(getText(result.content[0]!)).toContain("Updated quest [01]");
    expect(log.getAll()[0]?.description).toBe("New");
  });

  it("deletes a quest", async () => {
    const log = createLog();
    log.add("Old");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.delete, id: "01" });
    expect(getText(result.content[0]!)).toContain("Deleted quest [01]");
    expect(log.getAll()).toHaveLength(0);
  });

  it("deletes multiple tasks when all incomplete child steps are selected", async () => {
    const log = createLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    log.add("Another");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.delete,
      ids: ["01", "02", "03"],
    });
    expect(getText(result.content[0]!)).toContain("Deleted 3 tasks");
    expect(log.getAll()).toHaveLength(0);
  });

  it("undoes last action", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.undo });
    expect(getText(result.content[0]!)).toContain("Reverted add quest [01]");
  });

  it("redoes last undone action", async () => {
    const log = createLog();
    log.add("A");
    await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.undo });
    const result = await questToolExecute(log, "tc2", { action: QUEST_ACTIONS.redo });
    expect(getText(result.content[0]!)).toContain("Redone add quest [01]");
  });

  it("includes full quest list in details for add action", async () => {
    const log = createLog();
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.add,
      descriptions: ["A", "B"],
    });
    const details = result.details as { quests: unknown[]; displayQuests?: unknown[] };
    expect(details.quests).toHaveLength(2);
    expect(details.displayQuests).toEqual(details.quests);
  });

  it("includes only affected quest in displayQuests for toggle", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.toggle, id: "01" });
    const details = result.details as { quests: unknown[]; displayQuests?: unknown[] };
    expect(details.quests).toHaveLength(1);
    expect(details.displayQuests).toHaveLength(1);
    expect((details.displayQuests![0] as { done: boolean }).done).toBe(true);
  });

  it("includes all affected tasks in displayQuests for batch toggle", async () => {
    const log = createLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.toggle,
      ids: ["01", "02"],
    });
    const details = result.details as { quests: unknown[]; displayQuests?: unknown[] };
    expect(details.quests).toHaveLength(2);
    expect(details.displayQuests).toHaveLength(2);
    expect((details.displayQuests ?? []).every((quest) => (quest as { done: boolean }).done)).toBe(
      true,
    );
  });

  it("includes only affected quest in displayQuests for update", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.update,
      id: "01",
      description: "B",
    });
    const details = result.details as { quests: unknown[]; displayQuests?: unknown[] };
    expect(details.quests).toHaveLength(1);
    expect(details.displayQuests).toHaveLength(1);
    expect((details.displayQuests![0] as { description: string }).description).toBe("B");
  });

  it("includes only affected quest in displayQuests for delete", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.delete, id: "01" });
    const details = result.details as { quests: unknown[]; displayQuests?: unknown[] };
    expect(details.quests).toHaveLength(0);
    expect(details.displayQuests).toHaveLength(1);
    expect((details.displayQuests![0] as { description: string }).description).toBe("A");
  });

  it("includes deleted snapshots for batch delete rendering", async () => {
    const log = createLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    log.add("Another");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.delete,
      ids: ["01", "02", "03"],
    });
    const details = result.details as {
      quests: unknown[];
      displayQuests?: unknown[];
      snapshotQuests?: unknown[];
    };
    expect(details.quests).toHaveLength(0);
    expect(details.displayQuests).toHaveLength(3);
    expect(details.snapshotQuests).toHaveLength(3);
  });

  it("sets empty displayQuests for clear", async () => {
    const log = createLog();
    log.add("A");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.clear, all: true });
    const details = result.details as { quests: unknown[]; displayQuests?: unknown[] };
    expect(details.quests).toHaveLength(0);
    expect(details.displayQuests).toEqual([]);
  });

  it("reparents a quest via tool", async () => {
    const log = createLog();
    log.add("Parent");
    const q = log.add("Child");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.reparent,
      id: q.id,
      parentId: "01",
    });
    expect(getText(result.content[0]!)).toContain("Moved quest");
    expect(log.getSteps("01")).toHaveLength(1);
  });
  it("promotes a step via tool", async () => {
    const log = createLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.reparent,
      id: "02",
    });
    expect(getText(result.content[0]!)).toContain("Promoted");
    expect(log.getQuests()).toHaveLength(2);
  });
  it("reorders via tool", async () => {
    const log = createLog();
    log.add("A");
    log.add("B");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.reorder,
      id: "02",
      targetId: "01",
    });
    expect(getText(result.content[0]!)).toContain("Reordered quest [02]: B");
    expect(log.getAll()[0]!.description).toBe("B");
  });

  it("clears done via tool default", async () => {
    const log = createLog();
    log.add("A");
    log.add("B");
    log.toggle("01");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.clear });
    expect(getText(result.content[0]!)).toContain("Cleared 1 completed quests");
    expect(log.getAll()).toHaveLength(1);
    expect(log.getAll()[0]!.description).toBe("B");
  });

  it("returns skill document for rules action", async () => {
    const log = createLog();
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.rules });
    expect(getText(result.content[0]!)).toContain("name: quest-management");
  });
  it("returns skill document for skill alias", async () => {
    const log = createLog();
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.skill });
    expect(getText(result.content[0]!)).toContain("name: quest-management");
  });
  it("toggle blocked when parent has incomplete steps", async () => {
    const log = createLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.toggle, id: "01" });
    expect(getText(result.content[0]!)).toContain("incomplete steps");
    expect(log.getAll()[0]!.done).toBe(false);
  });

  it("delete blocked when parent has incomplete steps", async () => {
    const log = createLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    const result = await questToolExecute(log, "tc1", { action: QUEST_ACTIONS.delete, id: "01" });
    expect(getText(result.content[0]!)).toContain("incomplete steps");
    expect(log.getAll()).toHaveLength(2);
  });

  it("batch delete is blocked when an incomplete child step is not explicitly selected", async () => {
    const log = createLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    log.add("Another");
    const result = await questToolExecute(log, "tc1", {
      action: QUEST_ACTIONS.delete,
      ids: ["01", "03"],
    });
    expect(getText(result.content[0]!)).toContain("incomplete steps");
    expect(log.getAll()).toHaveLength(3);
  });
});

describe("registerQuestTool", () => {
  it("registers quest tool with promptSnippet and promptGuidelines", () => {
    const pi = {
      registerTool: vi.fn(),
    };
    const log = new QuestLog();
    registerQuestTool(pi as unknown as ExtensionAPI, log, DEFAULT_CONFIG);
    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "quest",
        promptSnippet: expect.any(String),
        promptGuidelines: expect.arrayContaining([
          expect.stringContaining("Before reading files, running commands, or making edits"),
        ]),
      }),
    );
  });
});
