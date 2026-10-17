import { describe, expect, it } from "vitest";
import { QuestLog } from "../../../src/quest/dataplane.js";
import { DEFAULT_CONFIG, type ResolvedConfig } from "../../../src/quest/defaults.js";
import { QUEST_ACTIONS } from "../../../src/quest/types.js";

// A 1-character ID space caps the log at 16 items, so exhaustion is cheap to
// reach without the Math.random mocking used elsewhere.
const tinyConfig: ResolvedConfig = { ...DEFAULT_CONFIG, ids: { length: 1 } };

function fillTo(log: QuestLog, target: number): void {
  while (log.getUsedIds().length < target) log.add("filler");
}

describe("atomic multi-step mutations", () => {
  it("rolls back a split that runs out of IDs partway through", () => {
    const log = new QuestLog(tinyConfig);
    const parent = log.add("parent");
    fillTo(log, 14); // 14 of 16 IDs used -> only 2 free

    const usedBefore = log.getUsedIds().length;
    const allBefore = log.getAll().length;

    // Splitting into 3 needs 3 IDs but only 2 are free.
    expect(() => log.split(parent.id, ["a", "b", "c"])).toThrow(/No available quest IDs/);

    // The two steps that were created before exhaustion must be rolled back.
    expect(log.getUsedIds().length).toBe(usedBefore);
    expect(log.getAll().length).toBe(allBefore);
    expect(log.getSteps(parent.id)).toHaveLength(0);
  });

  it("splits normally when there is room", () => {
    const log = new QuestLog(tinyConfig);
    const parent = log.add("parent");

    const steps = log.split(parent.id, ["a", "b"]);

    expect(steps).toHaveLength(2);
    expect(log.getSteps(parent.id)).toHaveLength(2);
  });

  it("rolls back a batch add that runs out of IDs partway through", () => {
    const log = new QuestLog(tinyConfig);
    fillTo(log, 15); // 15 of 16 used -> only 1 free

    const usedBefore = log.getUsedIds().length;
    const allBefore = log.getAll().length;

    const result = log.execute({
      type: QUEST_ACTIONS.add,
      descriptions: ["x", "y", "z"],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("No available quest IDs");
    // The one quest created before exhaustion must be rolled back.
    expect(log.getUsedIds().length).toBe(usedBefore);
    expect(log.getAll().length).toBe(allBefore);
  });

  it("leaves the log usable after a rolled-back batch add", () => {
    const log = new QuestLog(tinyConfig);
    fillTo(log, 15);

    log.execute({ type: QUEST_ACTIONS.add, descriptions: ["x", "y", "z"] });

    // One free ID remains; a normal add and its undo should still work.
    const added = log.add("solo");
    expect(log.getAll().map((q) => q.id)).toContain(added.id);
    const undo = log.execute({ type: QUEST_ACTIONS.undo });
    expect(undo.success).toBe(true);
    expect(log.getAll().map((q) => q.id)).not.toContain(added.id);
  });

  it("adds a whole batch atomically when there is room", () => {
    const log = new QuestLog(tinyConfig);

    const result = log.execute({
      type: QUEST_ACTIONS.add,
      descriptions: ["a", "b", "c"],
    });

    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(3);
  });
});
