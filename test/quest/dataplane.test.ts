import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestLog } from "../../src/quest/dataplane.js";
import { QUEST_ACTIONS } from "../../src/quest/types.js";

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

describe("QuestLog", () => {
  it("adds a quest and increments id", () => {
    const log = new QuestLog();
    const q = log.add("Test quest");
    expect(q.description).toBe("Test quest");
    expect(q.done).toBe(false);
    expect(log.getAll()).toHaveLength(1);
  });

  it("toggles quest state", () => {
    const log = new QuestLog();
    const q = log.add("Test");
    const toggled = log.toggle(q.id);
    expect(toggled?.done).toBe(true);
    expect(log.toggle(q.id)?.done).toBe(false);
  });

  it("toggles multiple tasks atomically", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = log.toggleMany([parent.id, "02"]);
    expect("error" in result).toBe(false);
    expect(log.getAll().every((quest) => quest.done)).toBe(true);
  });

  it("returns undefined when toggling nonexistent quest", () => {
    const log = new QuestLog();
    expect(log.toggle("ff")).toBeUndefined();
  });

  it("clears all quests and returns count", () => {
    const log = new QuestLog();
    log.add("A");
    log.add("B");
    expect(log.clear(true)).toBe(2);
    expect(log.getAll()).toHaveLength(0);
  });

  it("clear defaults to removing done quests, keeps ids stable, and can revert", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    log.toggle(a.id);
    expect(log.clear()).toBe(1);
    expect(log.getAll()).toHaveLength(1);
    expect(log.getAll()[0]?.id).toBe(b.id);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
    expect(log.getAll().map((q) => ({ id: q.id, desc: q.description }))).toEqual([
      { id: a.id, desc: "A" },
      { id: b.id, desc: "B" },
    ]);
  });

  it("clear all removes everything and can revert", () => {
    const log = new QuestLog();
    log.add("A");
    log.add("B");
    expect(log.clear(true)).toBe(2);
    expect(log.getAll()).toHaveLength(0);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
  });

  it("reorder changes quest position, keeps ids stable, and can revert", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    const c = log.add("C");
    const reordered = log.reorder(b.id, a.id);
    expect(reordered?.description).toBe("B");
    expect(reordered?.id).toBe(b.id);
    expect(log.getAll().map((q) => ({ id: q.id, desc: q.description }))).toEqual([
      { id: b.id, desc: "B" },
      { id: a.id, desc: "A" },
      { id: c.id, desc: "C" },
    ]);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll().map((q) => ({ id: q.id, desc: q.description }))).toEqual([
      { id: a.id, desc: "A" },
      { id: b.id, desc: "B" },
      { id: c.id, desc: "C" },
    ]);
  });

  it("undoes add", () => {
    const log = new QuestLog();
    log.add("A");
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(0);
  });

  it("undoes toggle", () => {
    const log = new QuestLog();
    const q = log.add("A");
    log.toggle(q.id);
    expect(q.done).toBe(true);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(q.done).toBe(false);
  });

  it("undoes toggle on step", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    log.toggle(step.id);
    expect(step.done).toBe(true);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(step.done).toBe(false);
  });

  it("undoes and redoes batch toggle as a single action", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const toggled = log.toggleMany([parent.id, "02"]);
    expect("error" in toggled).toBe(false);
    expect(log.getAll().every((quest) => quest.done)).toBe(true);

    const undone = log.undo();
    expect(undone.success).toBe(true);
    expect(log.getAll().every((quest) => !quest.done)).toBe(true);

    const redone = log.redo();
    expect(redone.success).toBe(true);
    expect(log.getAll().every((quest) => quest.done)).toBe(true);
  });

  it("undoes clear", () => {
    const log = new QuestLog();
    log.add("A");
    log.add("B");
    log.clear(true);
    expect(log.getAll()).toHaveLength(0);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
  });

  it("updates a quest description", () => {
    const log = new QuestLog();
    const q = log.add("Old desc");
    const updated = log.update(q.id, "New desc");
    expect(updated?.description).toBe("New desc");
    expect(log.getAll()[0]?.description).toBe("New desc");
  });

  it("updates a step description", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    const updated = log.update(step.id, "New desc");
    expect(updated?.description).toBe("New desc");
    expect(log.getSteps(parent.id)[0]?.description).toBe("New desc");
  });

  it("returns undefined when updating nonexistent quest", () => {
    const log = new QuestLog();
    expect(log.update("ff", "X")).toBeUndefined();
  });

  it("deletes a quest", () => {
    const log = new QuestLog();
    const a = log.add("A");
    log.add("B");
    const deleted = log.delete(a.id);
    expect(deleted?.description).toBe("A");
    expect(log.getAll()).toHaveLength(1);
  });

  it("deletes multiple tasks atomically when incomplete child steps are explicitly selected", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    log.add("Another");
    const result = log.deleteMany([parent.id, "02", "03"]);
    expect("error" in result).toBe(false);
    expect(log.getAll()).toHaveLength(0);
  });

  it("does not let duplicate ids bypass the incomplete-step delete guard", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = log.deleteMany([parent.id, parent.id]);
    expect(result).toEqual({ error: "blocked", id: parent.id });
    expect(log.getAll()).toHaveLength(2);
  });

  it("returns undefined when deleting nonexistent quest", () => {
    const log = new QuestLog();
    expect(log.delete("ff")).toBeUndefined();
  });

  it("undoes delete", () => {
    const log = new QuestLog();
    const a = log.add("A");
    log.add("B");
    log.delete(a.id);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
  });

  it("undoes and redoes batch delete as a single action", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    log.add("Another");
    const deleted = log.deleteMany([parent.id, "02", "03"]);
    expect("error" in deleted).toBe(false);
    expect(log.getAll()).toHaveLength(0);

    const undone = log.undo();
    expect(undone.success).toBe(true);
    expect(log.getAll()).toHaveLength(3);

    const redone = log.redo();
    expect(redone.success).toBe(true);
    expect(log.getAll()).toHaveLength(0);
  });

  it("reparent promotes a step to top-level quest", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    const reparented = log.reparent(step.id);
    expect(reparented?.description).toBe("Sub");
    expect(log.getQuests()).toHaveLength(2);
    expect(log.getSteps(parent.id)).toHaveLength(0);
  });
  it("reparent demotes a quest to a step", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const quest = log.add("Child");
    const reparented = log.reparent(quest.id, parent.id);
    expect("parentId" in reparented! && reparented.parentId).toBe(parent.id);
    expect(log.getQuests()).toHaveLength(1);
    expect(log.getSteps(parent.id)).toHaveLength(1);
  });
  it("reparent reparents a step", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    const step = log.addStep("Sub", a.id);
    log.reparent(step.id, b.id);
    expect(log.getSteps(a.id)).toHaveLength(0);
    expect(log.getSteps(b.id)).toHaveLength(1);
  });
  it("reparent rejects invalid targets", () => {
    const log = new QuestLog();
    const p = log.add("P");
    const step = log.addStep("S", p.id);
    const q = log.add("Q");
    expect(() => log.reparent(q.id, q.id)).toThrow("own parent");
    expect(() => log.reparent(q.id, "02")).toThrow("Step");
    log.toggle(step.id);
    log.toggle(p.id);
    expect(() => log.reparent(q.id, p.id)).toThrow("completed");
    const p2 = log.add("P2");
    const r = log.add("R");
    log.addStep("Sub", r.id);
    expect(() => log.reparent(r.id, p2.id)).toThrow("steps");
  });
  it("undoes reparent promotion, demotion, and reparent", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    const step = log.addStep("Sub", a.id);
    log.reparent(step.id);
    expect(log.undo().success).toBe(true);
    expect(log.getSteps(a.id)).toHaveLength(1);
    log.reparent(b.id, a.id);
    expect(log.undo().success).toBe(true);
    expect(log.getQuests()).toHaveLength(2);
    log.reparent(step.id, b.id);
    expect(log.undo().success).toBe(true);
    expect(log.getSteps(a.id)).toHaveLength(1);
  });
  it("execute reparent returns error without id", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.reparent });
    expect(result.success).toBe(false);
    expect(result.message).toContain("id is required");
  });
  it("undoes delete of parent and restores cascade-deleted steps", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    log.toggle(step.id);
    log.toggle(parent.id);
    log.delete(parent.id);
    expect(log.getAll()).toHaveLength(0);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
    expect(log.getSteps(parent.id)).toHaveLength(1);
  });

  it("undoes add of step", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    expect(log.getSteps(parent.id)).toHaveLength(1);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getSteps(parent.id)).toHaveLength(0);
  });

  it("delete removes the id from usedIds", () => {
    const log = new QuestLog();
    const a = log.add("A");
    log.add("B");
    expect(log.getUsedIds()).toContain(a.id);
    log.delete(a.id);
    expect(log.getUsedIds()).not.toContain(a.id);
  });

  it("undo delete restores the id to usedIds", () => {
    const log = new QuestLog();
    const a = log.add("A");
    log.add("B");
    log.delete(a.id);
    expect(log.getUsedIds()).not.toContain(a.id);
    log.undo();
    expect(log.getUsedIds()).toContain(a.id);
  });

  it("clear(false) removes done quest ids from usedIds", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    log.toggle(a.id);
    expect(log.getUsedIds()).toContain(a.id);
    expect(log.getUsedIds()).toContain(b.id);
    log.clear();
    expect(log.getUsedIds()).not.toContain(a.id);
    expect(log.getUsedIds()).toContain(b.id);
  });

  it("clear(true) removes all ids from usedIds", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    expect(log.getUsedIds()).toContain(a.id);
    expect(log.getUsedIds()).toContain(b.id);
    log.clear(true);
    expect(log.getUsedIds()).toHaveLength(0);
  });

  it("undo clear restores usedIds", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    log.clear(true);
    expect(log.getUsedIds()).toHaveLength(0);
    log.undo();
    expect(log.getUsedIds()).toContain(a.id);
    expect(log.getUsedIds()).toContain(b.id);
  });

  it("undoes update", () => {
    const log = new QuestLog();
    const q = log.add("Original");
    log.update(q.id, "Changed");
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()[0]?.description).toBe("Original");
  });

  it("undoes update on step", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    log.update(step.id, "Changed");
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getSteps(parent.id)[0]?.description).toBe("Sub");
  });

  it("returns nothing to undo when history is empty", () => {
    const log = new QuestLog();
    const result = log.undo();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Nothing to undo");
  });

  it("returns nothing to redo when redo stack is empty", () => {
    const log = new QuestLog();
    const result = log.redo();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Nothing to redo");
  });

  it("redoes an undone add with the same id", () => {
    const log = new QuestLog();
    const q = log.add("A");
    log.undo();
    expect(log.getAll()).toHaveLength(0);
    const result = log.redo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(1);
    expect(log.getAll()[0]!.id).toBe(q.id);
    expect(log.getAll()[0]!.description).toBe("A");
  });

  it("redoes an undone toggle", () => {
    const log = new QuestLog();
    const q = log.add("A");
    log.toggle(q.id);
    expect(q.done).toBe(true);
    log.undo();
    expect(q.done).toBe(false);
    const result = log.redo();
    expect(result.success).toBe(true);
    expect(q.done).toBe(true);
  });

  it("redoes an undone delete", () => {
    const log = new QuestLog();
    const a = log.add("A");
    log.add("B");
    log.delete(a.id);
    expect(log.getAll()).toHaveLength(1);
    log.undo();
    expect(log.getAll()).toHaveLength(2);
    const result = log.redo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(1);
  });

  it("clears redo stack after a new mutation", () => {
    const log = new QuestLog();
    log.add("A");
    log.undo();
    expect(log.getAll()).toHaveLength(0);
    log.add("B");
    const result = log.redo();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Nothing to redo");
  });

  it("chains undo and redo across multiple actions", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    log.toggle(a.id);
    log.update(b.id, "B updated");
    expect(log.getAll()[0]!.done).toBe(true);
    expect(log.getAll()[1]!.description).toBe("B updated");
    log.undo();
    log.undo();
    expect(log.getAll()[0]!.done).toBe(false);
    expect(log.getAll()[1]!.description).toBe("B");
    log.redo();
    log.redo();
    expect(log.getAll()[0]!.done).toBe(true);
    expect(log.getAll()[1]!.description).toBe("B updated");
  });

  it("undoes reorder after clear because quest references are preserved", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    log.reorder(b.id, a.id);
    expect(log.getAll().map((q) => q.description)).toEqual(["B", "A"]);
    log.clear(true);
    expect(log.getAll()).toHaveLength(0);
    log.undo();
    expect(log.getAll().map((q) => q.description)).toEqual(["B", "A"]);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll().map((q) => q.description)).toEqual(["A", "B"]);
  });

  it("reconstructs state from session branch", () => {
    const log = new QuestLog();
    const entries = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: { quests: [{ id: "01", description: "X", done: true, createdAt: 1 }] },
        },
      },
    ];
    const ctx = {
      sessionManager: { getBranch: vi.fn().mockReturnValue(entries) },
    } as unknown as ExtensionContext;
    log.reconstructFromSession(ctx);
    expect(log.getAll()).toEqual([{ id: "01", description: "X", done: true, createdAt: 1 }]);
  });
});

describe("QuestLog.execute", () => {
  it("executes add action", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.add, descriptions: ["Test"] });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Added quest [01]: Test");
    expect(log.getAll()).toHaveLength(1);
  });

  it("returns error for add without description", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.add });
    expect(result.success).toBe(false);
    expect(result.message).toContain("At least one description is required");
  });

  it("executes batch add action", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.add, descriptions: ["A", "B"] });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Added 2 quests");
    expect(log.getAll()).toHaveLength(2);
  });

  it("returns error for batch add with empty descriptions", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.add, descriptions: ["A", "", "B"] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("non-empty");
    expect(log.getAll()).toHaveLength(0);
  });

  it("executes list action", () => {
    const log = new QuestLog();
    log.add("A");
    const result = log.execute({ type: QUEST_ACTIONS.list });
    expect(result.success).toBe(true);
    expect(result.message).toContain("A");
  });

  it("executes toggle action", () => {
    const log = new QuestLog();
    log.add("A");
    const result = log.execute({ type: QUEST_ACTIONS.toggle, id: "01" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Quest [01] done");
    expect(log.getAll()[0]!.done).toBe(true);
  });

  it("executes batch toggle action", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = log.execute({ type: QUEST_ACTIONS.toggle, ids: ["01", "02"] });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Toggled 2 tasks");
    expect(result.quests).toHaveLength(2);
    expect(log.getAll().every((quest) => quest.done)).toBe(true);
  });

  it("returns error for toggle without id", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.toggle });
    expect(result.success).toBe(false);
    expect(result.message).toContain("id is required");
  });

  it("blocks batch toggle when the final parent state would still have incomplete steps", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = log.execute({ type: QUEST_ACTIONS.toggle, ids: [parent.id] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("incomplete steps");
    expect(log.getAll().every((quest) => !quest.done)).toBe(true);
  });

  it("returns not found for toggle of missing quest", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.toggle, id: "ff" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("executes update action", () => {
    const log = new QuestLog();
    log.add("Old");
    const result = log.execute({ type: QUEST_ACTIONS.update, id: "01", description: "New" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Updated quest [01]");
    expect(log.getAll()[0]!.description).toBe("New");
  });

  it("returns error for update without id", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.update, description: "X" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("id is required");
  });

  it("returns error for update without description", () => {
    const log = new QuestLog();
    log.add("Old");
    const result = log.execute({ type: QUEST_ACTIONS.update, id: "01" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("description is required");
  });

  it("returns error for update with whitespace-only description", () => {
    const log = new QuestLog();
    log.add("Old");
    const result = log.execute({ type: QUEST_ACTIONS.update, id: "01", description: "   " });
    expect(result.success).toBe(false);
    expect(result.message).toContain("description is required");
  });

  it("executes delete action", () => {
    const log = new QuestLog();
    log.add("Old");
    const result = log.execute({ type: QUEST_ACTIONS.delete, id: "01" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Deleted quest [01]");
    expect(log.getAll()).toHaveLength(0);
  });

  it("executes batch delete action", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    log.add("Another");
    const result = log.execute({ type: QUEST_ACTIONS.delete, ids: ["01", "02", "03"] });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Deleted 3 tasks");
    expect(result.quests).toHaveLength(3);
    expect(log.getAll()).toHaveLength(0);
  });

  it("returns error for delete without id", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.delete });
    expect(result.success).toBe(false);
    expect(result.message).toContain("id is required");
  });

  it("executes clear action with all flag", () => {
    const log = new QuestLog();
    log.add("A");
    const result = log.execute({ type: QUEST_ACTIONS.clear, all: true });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Cleared 1 quests");
    expect(log.getAll()).toHaveLength(0);
  });

  it("executes clear action defaulting to done-only and keeps ids stable", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    log.toggle(a.id);
    const result = log.execute({ type: QUEST_ACTIONS.clear });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Cleared 1 completed quests");
    expect(log.getAll()).toHaveLength(1);
    expect(log.getAll()[0]?.id).toBe(b.id);
    expect(log.getAll()[0]?.description).toBe("B");
  });

  it("executes reorder action", () => {
    const log = new QuestLog();
    log.add("A");
    const b = log.add("B");
    const result = log.execute({ type: QUEST_ACTIONS.reorder, id: b.id, targetId: "01" });
    expect(result.success).toBe(true);
    expect(result.message).toContain(`Reordered quest [${b.id}]`);
    expect(log.getAll().map((q) => q.description)).toEqual(["B", "A"]);
    expect(log.getAll().map((q) => q.id)).toEqual([b.id, "01"]);
  });

  it("returns error for reorder without id", () => {
    const log = new QuestLog();
    log.add("A");
    const result = log.execute({ type: QUEST_ACTIONS.reorder, targetId: "01" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("id is required");
  });

  it("returns error for reorder without targetId", () => {
    const log = new QuestLog();
    const b = log.add("B");
    const result = log.execute({ type: QUEST_ACTIONS.reorder, id: b.id });
    expect(result.success).toBe(false);
    expect(result.message).toContain("targetId is required");
  });

  it("returns not found for reorder of missing quest", () => {
    const log = new QuestLog();
    const result = log.execute({ type: QUEST_ACTIONS.reorder, id: "ff", targetId: "01" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("returns not found for reorder with missing targetId", () => {
    const log = new QuestLog();
    const b = log.add("B");
    const result = log.execute({ type: QUEST_ACTIONS.reorder, id: b.id, targetId: "ff" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("returns error when all quest IDs are exhausted", () => {
    const log = new QuestLog();
    (log as unknown as { usedIds: Set<string> }).usedIds = new Set(
      Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0")),
    );
    const result = log.execute({ type: QUEST_ACTIONS.add, descriptions: ["Test"] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("No available quest IDs");
    expect(result.message).toContain("Clear done or all quests");
  });

  it("executes undo action", () => {
    const log = new QuestLog();
    log.add("A");
    const result = log.execute({ type: QUEST_ACTIONS.undo });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Reverted add quest [01]");
    expect(log.getAll()).toHaveLength(0);
  });
});

describe("Step", () => {
  it("addStep creates a Step", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    expect(step.parentId).toBe(parent.id);
    expect(step.description).toBe("Sub");
    expect(log.getSteps(parent.id)).toHaveLength(1);
  });

  it("getSteps and getParent return correct values", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    expect(log.getSteps(parent.id)).toEqual([step]);
    expect(log.getParent(step)).toEqual(parent);
  });

  it("getAll interleaves steps after their parent", () => {
    const log = new QuestLog();
    const a = log.add("A");
    log.add("B");
    log.addStep("Sub A", a.id);
    const all = log.getAll();
    expect(all.map((q) => q.description)).toEqual(["A", "Sub A", "B"]);
    expect("parentId" in all[1]! && all[1].parentId).toBe(a.id);
  });

  it("toggling a parent with incomplete steps returns null", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    expect(log.toggle(parent.id)).toBeNull();
  });

  it("toggling a parent succeeds once all steps are done", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    log.toggle(step.id);
    const result = log.toggle(parent.id);
    expect(result?.done).toBe(true);
  });

  it("reorder returns undefined when either id is a step", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    const step = log.addStep("Sub", a.id);
    expect(log.reorder(step.id, b.id)).toBeUndefined();
    expect(log.reorder(a.id, step.id)).toBeUndefined();
  });

  it("deleting a parent with incomplete steps returns null", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    expect(log.delete(parent.id)).toBeNull();
  });

  it("deleting a parent with all steps done cascade-deletes them", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    log.toggle(step.id);
    log.toggle(parent.id);
    const deleted = log.delete(parent.id);
    expect(deleted?.description).toBe("Parent");
    expect(log.getAll()).toHaveLength(0);
    expect(log.getSteps(parent.id)).toHaveLength(0);
  });

  it("deleting a step removes only that entry", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    const deleted = log.delete(step.id);
    expect(deleted?.description).toBe("Sub");
    expect(log.getAll()).toHaveLength(1);
    expect(log.getSteps(parent.id)).toHaveLength(0);
  });

  it("clear removes done quests and steps and can revert", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    log.toggle(step.id);
    expect(log.clear()).toBe(1);
    expect(log.getAll()).toHaveLength(1);
    expect(log.getSteps(parent.id)).toHaveLength(0);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
  });

  it("clear removes orphaned steps when parent is done but step is not", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    // Simulate impossible state directly: parent done with incomplete step
    parent.done = true;
    expect(log.clear()).toBe(2);
    expect(log.getAll()).toHaveLength(0);
    expect(log.getSteps(parent.id)).toHaveLength(0);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
  });

  it("clear all removes everything and can revert", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    expect(log.clear(true)).toBe(2);
    expect(log.getAll()).toHaveLength(0);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getAll()).toHaveLength(2);
  });

  it("undo delete restores a step", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    log.delete(step.id);
    const result = log.undo();
    expect(result.success).toBe(true);
    expect(log.getSteps(parent.id)).toHaveLength(1);
  });

  it("reconstructFromSession splits quests with parentId into steps", () => {
    const log = new QuestLog();
    const entries = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: {
            quests: [
              { id: "01", description: "Parent", done: false, createdAt: 1 },
              { id: "02", description: "Sub", done: false, createdAt: 2, parentId: "01" },
            ],
          },
        },
      },
    ];
    const ctx = {
      sessionManager: { getBranch: vi.fn().mockReturnValue(entries) },
    } as unknown as ExtensionContext;
    log.reconstructFromSession(ctx);
    expect(log.getAll()).toHaveLength(2);
    expect(log.getSteps("01")).toHaveLength(1);
  });

  it("split creates multiple steps", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const steps = log.split(parent.id, ["A", "B"]);
    expect(steps).toHaveLength(2);
    expect(log.getSteps(parent.id)).toHaveLength(2);
  });

  it("split rejects missing parent", () => {
    const log = new QuestLog();
    expect(() => log.split("ff", ["A"])).toThrow("not found");
  });

  it("split rejects done parent", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.toggle(parent.id);
    expect(() => log.split(parent.id, ["A"])).toThrow("completed parent");
  });

  it("execute split creates a step", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const result = log.execute({
      type: QUEST_ACTIONS.split,
      id: parent.id,
      descriptions: ["Sub"],
    });
    expect(result.success).toBe(true);
    expect(log.getSteps(parent.id)).toHaveLength(1);
  });

  it("execute split returns not found for invalid id", () => {
    const log = new QuestLog();
    const result = log.execute({
      type: QUEST_ACTIONS.split,
      id: "ff",
      descriptions: ["Sub"],
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("execute split with step id returns clear error", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    const result = log.execute({
      type: QUEST_ACTIONS.split,
      id: step.id,
      descriptions: ["Nested"],
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("cannot have nested steps");
  });

  it("addStep with step parentId throws clear error", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const step = log.addStep("Sub", parent.id);
    expect(() => log.addStep("Nested", step.id)).toThrow("cannot have nested steps");
  });

  it("execute split rejects done parent", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.toggle(parent.id);
    const result = log.execute({
      type: QUEST_ACTIONS.split,
      id: parent.id,
      descriptions: ["Sub"],
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("completed parent");
  });

  it("execute update works on steps", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = log.execute({
      type: QUEST_ACTIONS.update,
      id: "02",
      description: "Updated sub",
    });
    expect(result.success).toBe(true);
    expect(log.getSteps(parent.id)[0]?.description).toBe("Updated sub");
  });

  it("execute reorder returns step error", () => {
    const log = new QuestLog();
    const a = log.add("A");
    const b = log.add("B");
    const step = log.addStep("Sub", a.id);
    const result = log.execute({
      type: QUEST_ACTIONS.reorder,
      id: step.id,
      targetId: b.id,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("step");
  });

  it("execute toggle returns blocked error when parent has incomplete steps", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = log.execute({ type: QUEST_ACTIONS.toggle, id: parent.id });
    expect(result.success).toBe(false);
    expect(result.message).toContain("incomplete steps");
    expect(log.getAll()[0]!.done).toBe(false);
  });

  it("execute delete returns blocked error when parent has incomplete steps", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    const result = log.execute({ type: QUEST_ACTIONS.delete, id: parent.id });
    expect(result.success).toBe(false);
    expect(result.message).toContain("incomplete steps");
    expect(log.getAll()).toHaveLength(2);
  });

  it("execute batch delete requires selecting incomplete child steps explicitly", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    log.add("Another");
    const result = log.execute({ type: QUEST_ACTIONS.delete, ids: [parent.id, "03"] });
    expect(result.success).toBe(false);
    expect(result.message).toContain("incomplete steps");
    expect(log.getAll()).toHaveLength(3);
  });

  it("execute batch delete allows deleting a parent when its incomplete child steps are selected", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Sub", parent.id);
    log.add("Another");
    const result = log.execute({ type: QUEST_ACTIONS.delete, ids: [parent.id, "02", "03"] });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Deleted 3 tasks");
    expect(log.getAll()).toHaveLength(0);
  });
});
