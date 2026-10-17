import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidQuestLogStateError, QuestLog } from "../../../src/quest/dataplane.js";
import { QUEST_ACTIONS } from "../../../src/quest/types.js";

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

const EMPTY_STATE = { version: 1, quests: [], steps: [], usedIds: [], history: [], redoStack: [] };

const record = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  description: `Quest ${id}`,
  done: false,
  createdAt: 1,
  ...extra,
});
const ORPHAN_STEP_STATE = {
  ...EMPTY_STATE,
  quests: [record("01")],
  steps: [record("02", { parentId: "09" })],
  usedIds: ["01", "02"],
};

function reload(log: QuestLog): QuestLog {
  return QuestLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
}

function descriptions(log: QuestLog): string[] {
  return log.getAll().map((quest) => quest.description);
}

describe("QuestLog JSON state", () => {
  it("serializes quests, steps, used ids and both stacks as plain JSON", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Step", parent.id);
    log.add("Other");
    log.undo();

    const state = log.toJSON();

    expect(state).toEqual({
      version: 1,
      quests: [{ id: "01", description: "Parent", done: false, createdAt: expect.any(Number) }],
      steps: [
        {
          id: "02",
          description: "Step",
          done: false,
          createdAt: expect.any(Number),
          parentId: "01",
        },
      ],
      usedIds: ["01", "02"],
      history: [
        { type: "add", id: "01" },
        { type: "add", id: "02", parentId: "01" },
      ],
      redoStack: [
        {
          type: "add",
          quest: { id: "03", description: "Other", done: false, createdAt: expect.any(Number) },
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("returns a copy that shares no objects with the log", () => {
    const log = new QuestLog();
    log.add("Original");

    log.toJSON().quests[0]!.description = "Changed";

    expect(descriptions(log)).toEqual(["Original"]);
  });

  it("drops undefined optional fields so the state is strict JSON", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const child = log.add("Child");
    log.reparent(child.id, parent.id);

    const [entry] = log.toJSON().history.slice(-1);

    expect(entry).toEqual({ type: "reparent", id: child.id, previousQuestIndex: 1 });
  });

  it("restores quests, steps and used ids", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    log.addStep("Step", parent.id);

    const restored = reload(log);

    expect(restored.getAll()).toEqual(log.getAll());
    expect(restored.getSteps(parent.id)).toHaveLength(1);
    expect(restored.getUsedIds()).toEqual(["01", "02"]);
    expect(restored.add("Next").id).toBe("03");
  });

  it("copies the state it restores", () => {
    const input = {
      ...EMPTY_STATE,
      quests: [{ id: "01", description: "Mine", done: false, createdAt: 1 }],
      usedIds: ["01"],
    };

    const log = QuestLog.fromJSON(input);
    input.quests[0]!.description = "Changed";

    expect(descriptions(log)).toEqual(["Mine"]);
  });

  it("undoes and redoes across reloads", () => {
    const log = new QuestLog();
    const quest = log.add("Draft");
    log.execute({ type: QUEST_ACTIONS.update, id: quest.id, description: "Final" });
    log.execute({ type: QUEST_ACTIONS.toggle, id: quest.id });

    const restored = reload(log);
    expect(restored.execute({ type: QUEST_ACTIONS.undo }).success).toBe(true);
    expect(restored.getAll()[0]!.done).toBe(false);
    expect(restored.execute({ type: QUEST_ACTIONS.undo }).success).toBe(true);
    expect(descriptions(restored)).toEqual(["Draft"]);

    const again = reload(restored);
    expect(again.execute({ type: QUEST_ACTIONS.redo }).success).toBe(true);
    expect(descriptions(again)).toEqual(["Final"]);
    expect(again.execute({ type: QUEST_ACTIONS.redo }).success).toBe(true);
    expect(again.getAll()[0]!.done).toBe(true);
  });

  it("undoes a reorder after a reload that follows reorder and clear", () => {
    const log = new QuestLog();
    const first = log.add("A");
    const second = log.add("B");
    log.reorder(second.id, first.id);
    log.clear(true);

    const restored = reload(log);

    restored.undo();
    expect(descriptions(restored)).toEqual(["B", "A"]);
    expect(restored.undo().success).toBe(true);
    expect(descriptions(restored)).toEqual(["A", "B"]);
  });

  it("undoes a reorder against the live quests after a reload", () => {
    const log = new QuestLog();
    const first = log.add("A");
    const second = log.add("B");
    log.reorder(second.id, first.id);

    const restored = reload(log);

    expect(restored.undo().success).toBe(true);
    expect(descriptions(restored)).toEqual(["A", "B"]);
  });

  it("keeps snapshots linked to live quests so later edits undo correctly", () => {
    const log = new QuestLog();
    const kept = log.add("Kept");
    const removed = log.add("Removed");
    log.delete(removed.id);
    log.toggle(kept.id);

    const restored = reload(log);
    restored.undo();
    restored.undo();

    expect(restored.getAll().map(({ description, done }) => ({ description, done }))).toEqual([
      { description: "Kept", done: false },
      { description: "Removed", done: false },
    ]);
  });

  it("restores a deleted quest even after a new quest reused its id", () => {
    const log = new QuestLog();
    const original = log.add("Original");
    log.delete(original.id);
    randomCall = 0;
    expect(log.add("Reused").id).toBe(original.id);

    const restored = reload(log);
    restored.undo();
    restored.undo();

    expect(descriptions(restored)).toEqual(["Original"]);
  });

  it("keeps only the newest 50 undo and redo entries when serializing", () => {
    const log = new QuestLog();
    for (let index = 1; index <= 60; index++) log.add(`Quest ${index}`);

    const added = log.toJSON();
    expect(added.history).toHaveLength(50);
    expect(added.history[0]).toEqual({ type: "add", id: log.getAll()[10]!.id });

    for (let index = 0; index < 60; index++) expect(log.undo().success).toBe(true);
    const undone = log.toJSON();
    expect(undone.history).toHaveLength(0);
    expect(undone.redoStack).toHaveLength(50);

    const restored = QuestLog.fromJSON(undone);
    for (let index = 0; index < 50; index++) expect(restored.redo().success).toBe(true);
    expect(restored.redo().success).toBe(false);
    expect(restored.getAll()).toHaveLength(50);
    expect(restored.getAll()[0]!.description).toBe("Quest 1");
  });

  it.each([
    ["a non-object", "nope"],
    ["a missing version", { ...EMPTY_STATE, version: undefined }],
    ["an unknown version", { ...EMPTY_STATE, version: 2 }],
    ["a missing quests array", { ...EMPTY_STATE, quests: undefined }],
    [
      "a quest without an id",
      { ...EMPTY_STATE, quests: [{ description: "x", done: false, createdAt: 1 }] },
    ],
    [
      "a top-level quest with a parent",
      {
        ...EMPTY_STATE,
        quests: [{ id: "01", description: "x", done: false, createdAt: 1, parentId: "02" }],
      },
    ],
    [
      "a step without a parent",
      { ...EMPTY_STATE, steps: [{ id: "01", description: "x", done: false, createdAt: 1 }] },
    ],
    ["numeric used ids", { ...EMPTY_STATE, usedIds: [1] }],
    ["an unknown history entry", { ...EMPTY_STATE, history: [{ type: "explode" }] }],
    ["an add entry without an id", { ...EMPTY_STATE, history: [{ type: "add" }] }],
    ["a malformed redo entry", { ...EMPTY_STATE, redoStack: [{ type: "toggle", ids: "01" }] }],
  ])("rejects %s", (_name, state) => {
    expect(() => QuestLog.fromJSON(state)).toThrow(/^Invalid quest log state/);
  });

  it.each([
    [
      "two quests with one id",
      { ...EMPTY_STATE, quests: [record("01"), record("01")], usedIds: ["01"] },
      /quest \[01\] appears twice/,
    ],
    [
      "a step that reuses a quest id",
      {
        ...EMPTY_STATE,
        quests: [record("01")],
        steps: [record("01", { parentId: "01" })],
        usedIds: ["01"],
      },
      /quest \[01\] appears twice/,
    ],
    [
      "a live id missing from usedIds",
      { ...EMPTY_STATE, quests: [record("01"), record("02")], usedIds: ["01"] },
      /quest \[02\] is missing from usedIds/,
    ],
    ["a step whose parent is missing", ORPHAN_STEP_STATE, /step \[02\] has no parent quest \[09\]/],
    [
      "a step whose parent is a step",
      {
        ...EMPTY_STATE,
        quests: [record("01")],
        steps: [record("02", { parentId: "01" }), record("03", { parentId: "02" })],
        usedIds: ["01", "02", "03"],
      },
      /step \[03\] has no parent quest \[02\]/,
    ],
  ])("rejects %s", (_name, state, reason) => {
    expect(() => QuestLog.fromJSON(state)).toThrow(reason);
  });

  it("accepts used ids that no live quest holds, since they only reserve ids", () => {
    const log = QuestLog.fromJSON({
      ...EMPTY_STATE,
      quests: [record("01")],
      usedIds: ["01", "02"],
    });

    expect(log.getUsedIds()).toEqual(["01", "02"]);
  });

  it.each([
    ["a malformed history entry", { ...EMPTY_STATE, history: [{ type: "add" }] }],
    ["a step without its parent", ORPHAN_STEP_STATE],
  ])("leaves the log unchanged when restore rejects %s", (_name, state) => {
    const log = new QuestLog();
    log.add("Keep me");

    expect(() => log.restore(state)).toThrow(InvalidQuestLogStateError);

    expect(descriptions(log)).toEqual(["Keep me"]);
    expect(log.undo().success).toBe(true);
  });
});

describe("QuestLog options", () => {
  it("returns the injected skill document for skill and rules", () => {
    const log = new QuestLog(undefined, { skillDocument: "Skill text" });

    expect(log.execute({ type: QUEST_ACTIONS.skill }).message).toBe("Skill text");
    expect(log.execute({ type: QUEST_ACTIONS.rules }).message).toBe("Skill text");
  });

  it("throws when skill runs without a skill document", () => {
    expect(() => new QuestLog().execute({ type: QUEST_ACTIONS.skill })).toThrow(/skill document/);
  });

  it("reports state changes to the injected debug callback", () => {
    const debug = vi.fn();
    const log = new QuestLog(undefined, { debug });

    log.add("Logged");

    expect(debug).toHaveBeenCalledWith(
      "quests:state",
      "add",
      expect.objectContaining({ description: "Logged" }),
    );
  });
});
