import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQuestStore,
  fitQuestsMetadata,
  METADATA_LIMIT_BYTES,
  USER_CHANGES_PREFIX,
} from "../../extensions/bb/store.js";
import type { HistoryEntry, QuestLogState, RedoEntry } from "../../src/quest/dataplane.js";
import { QUEST_ACTIONS } from "../../src/quest/types.js";

type ThreadResponse = ReturnType<typeof makeThreadResponse>;

const SKILL = "Read the quest-management skill.";

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

function createHost(options: { delayMs?: number; threads?: ThreadResponse[] } = {}) {
  const namespaces = new Map<string, Record<string, unknown>>();
  const key = (pluginId: string | undefined, threadId: string) =>
    `${pluginId ?? "pi-quests"}/${threadId}`;
  const pause = () => new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
  const { bb, harness } = createFakePluginHost({
    pluginId: "pi-quests",
    sdk: {
      threads: {
        getPluginMetadata: async ({ threadId, pluginId }) => {
          await pause();
          return structuredClone(namespaces.get(key(pluginId, threadId)) ?? {});
        },
        updatePluginMetadata: async ({ threadId, pluginId, set = {}, remove = [] }) => {
          await pause();
          const next = { ...namespaces.get(key(pluginId, threadId)), ...structuredClone(set) };
          for (const name of remove) delete next[name];
          namespaces.set(key(pluginId, threadId), next);
          return structuredClone(next);
        },
        get: async ({ threadId }) =>
          options.threads?.find((thread) => thread.id === threadId) ??
          makeThreadResponse({ id: threadId }),
      },
    },
  });
  return {
    store: createQuestStore(bb, SKILL),
    restart: () => createQuestStore(bb, SKILL),
    harness,
    saved: (threadId: string) => namespaces.get(key("quests", threadId)),
    seed: (threadId: string, value: Record<string, unknown>) =>
      namespaces.set(key("quests", threadId), value),
    updates: (threadId: string) =>
      harness.inspection.sdk
        .callsTo("threads.updatePluginMetadata")
        .filter(([args]) => (args as { threadId: string }).threadId === threadId),
  };
}

const forkThread = makeThreadResponse({
  id: "fork",
  originKind: "fork",
  originPluginId: null,
  sourceThreadId: "source",
});
const sideChatThread = makeThreadResponse({
  id: "side",
  originKind: "fork",
  originPluginId: "side-chat",
  sourceThreadId: "source",
});

async function descriptions(
  store: ReturnType<typeof createQuestStore>,
  threadId: string,
): Promise<string[]> {
  return (await store.getLog(threadId)).quests.map((quest) => quest.description);
}

describe("quest store", () => {
  it("starts a thread without saved quests empty, without writing", async () => {
    const { store, updates } = createHost();

    expect(await store.getLog("t1")).toEqual({
      quests: [],
      progress: { done: 0, total: 0, current: null },
    });
    expect(updates("t1")).toHaveLength(0);
  });

  it("saves all three keys in one update under the quests namespace, then publishes", async () => {
    const { store, harness, updates } = createHost();

    const result = await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["First"] });

    expect(result).toEqual({ text: "Added quest [01]: First", isError: false });
    expect(updates("t1")).toEqual([
      [
        {
          threadId: "t1",
          pluginId: "quests",
          set: {
            progress: { done: 0, total: 1, current: "First" },
            log: expect.objectContaining({ version: 1, usedIds: ["01"] }),
            pendingUserChanges: [],
          },
        },
      ],
    ]);
    expect(harness.inspection.realtimeSignals).toEqual([
      { channel: "quests", payload: { threadId: "t1" } },
    ]);
  });

  it("restores quests, steps, undo and redo after a restart", async () => {
    const { store, restart } = createHost();
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Parent"] });
    await store.runTool("t1", { type: QUEST_ACTIONS.split, id: "01", descriptions: ["Step"] });
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Other"] });
    await store.runTool("t1", { type: QUEST_ACTIONS.undo });

    const restarted = restart();

    expect(await descriptions(restarted, "t1")).toEqual(["Parent", "Step"]);
    expect((await restarted.runTool("t1", { type: QUEST_ACTIONS.redo })).isError).toBe(false);
    expect(await descriptions(restarted, "t1")).toEqual(["Parent", "Step", "Other"]);
    await restarted.runTool("t1", { type: QUEST_ACTIONS.undo });
    await restarted.runTool("t1", { type: QUEST_ACTIONS.undo });
    expect(await descriptions(restarted, "t1")).toEqual(["Parent"]);
  });

  it("counts quests and steps like pi's footer and names the first open top-level quest", async () => {
    const { store, saved } = createHost();
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Done first", "Next"] });
    await store.runTool("t1", { type: QUEST_ACTIONS.split, id: "02", descriptions: ["A", "B"] });
    await store.runTool("t1", { type: QUEST_ACTIONS.toggle, id: "01" });

    const view = await store.getLog("t1");

    expect(view.quests).toHaveLength(4);
    expect(view.progress).toEqual({ done: 1, total: 4, current: "Next" });
    expect(saved("t1")?.progress).toEqual(view.progress);
  });

  it("serializes concurrent writes to one thread so no update is lost", async () => {
    const { store } = createHost({ delayMs: 5 });

    await Promise.all([
      store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["From the agent"] }),
      store.mutate("t1", { type: QUEST_ACTIONS.add, descriptions: ["From the panel"] }),
      store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Agent again"] }),
    ]);

    expect(await descriptions(store, "t1")).toEqual([
      "From the agent",
      "From the panel",
      "Agent again",
    ]);
  });

  it("commits nothing when a tool action fails, so redo still works", async () => {
    const { store, updates } = createHost();
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Undone"] });
    await store.runTool("t1", { type: QUEST_ACTIONS.undo });
    const writes = updates("t1").length;

    const failed = await store.runTool("t1", { type: QUEST_ACTIONS.toggle, id: "ff" });

    expect(failed.isError).toBe(true);
    expect(failed.text).toContain("Quest [ff] not found");
    expect(updates("t1")).toHaveLength(writes);
    expect((await store.runTool("t1", { type: QUEST_ACTIONS.redo })).isError).toBe(false);
    expect(await descriptions(store, "t1")).toEqual(["Undone"]);
  });

  it("rejects a failed panel change without saving it or adding a notice", async () => {
    const { store, saved, updates } = createHost();
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Parent"] });
    await store.runTool("t1", { type: QUEST_ACTIONS.split, id: "01", descriptions: ["Step"] });
    const writes = updates("t1").length;

    await expect(store.mutate("t1", { type: QUEST_ACTIONS.toggle, id: "01" })).rejects.toThrow(
      "incomplete steps",
    );

    expect(updates("t1")).toHaveLength(writes);
    expect(saved("t1")?.pendingUserChanges).toEqual([]);
  });

  it("tells the agent about panel changes once, then clears them", async () => {
    const { store, saved } = createHost();

    const change = await store.mutate("t1", {
      type: QUEST_ACTIONS.add,
      descriptions: ["Panel quest"],
    });
    expect(change.message).toBe("Added quest [01]: Panel quest");
    expect(change.view.progress).toEqual({ done: 0, total: 1, current: "Panel quest" });
    expect(saved("t1")?.pendingUserChanges).toEqual(["Added quest [01]: Panel quest"]);

    const first = await store.runTool("t1", { type: QUEST_ACTIONS.list });
    expect(first.text).toBe(
      `${USER_CHANGES_PREFIX}\n- Added quest [01]: Panel quest\n\n${
        (await store.runTool("t1", { type: QUEST_ACTIONS.list })).text
      }`,
    );
    expect(saved("t1")?.pendingUserChanges).toEqual([]);
  });

  it("clears pending notices on a failed action without saving the action", async () => {
    const { store, saved, harness } = createHost();
    await store.mutate("t1", { type: QUEST_ACTIONS.add, descriptions: ["Panel quest"] });
    const signals = harness.inspection.realtimeSignals.length;
    const logBefore = saved("t1")?.log;

    const result = await store.runTool("t1", { type: QUEST_ACTIONS.delete, id: "ff" });

    expect(result.isError).toBe(true);
    expect(
      result.text.startsWith(`${USER_CHANGES_PREFIX}\n- Added quest [01]: Panel quest\n\n`),
    ).toBe(true);
    expect(saved("t1")?.pendingUserChanges).toEqual([]);
    expect(saved("t1")?.log).toEqual(logBefore);
    expect(harness.inspection.realtimeSignals).toHaveLength(signals + 1);
  });

  it("does not write for a read-only action with nothing pending", async () => {
    const { store, updates } = createHost();
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Only"] });
    const writes = updates("t1").length;

    await store.runTool("t1", { type: QUEST_ACTIONS.list });

    expect(updates("t1")).toHaveLength(writes);
  });

  it("answers skill and rules with the injected skill document", async () => {
    const { store } = createHost();

    expect(await store.runTool("t1", { type: QUEST_ACTIONS.skill })).toEqual({
      text: SKILL,
      isError: false,
    });
    expect((await store.runTool("t1", { type: QUEST_ACTIONS.rules })).text).toBe(SKILL);
  });

  it.each([
    ["an invalid log", { progress: { done: 0, total: 0, current: null }, log: { version: 9 } }],
    [
      "invalid pending notices",
      {
        progress: { done: 0, total: 0, current: null },
        log: { version: 1, quests: [], steps: [], usedIds: [], history: [], redoStack: [] },
        pendingUserChanges: "nope",
      },
    ],
  ])("reports %s instead of starting a blank log", async (_case, value) => {
    const { store, seed, updates } = createHost();
    seed("t1", value);

    await expect(store.getLog("t1")).rejects.toThrow(/saved quests for thread t1 are invalid/i);
    await expect(
      store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["Lost?"] }),
    ).rejects.toThrow(/invalid/i);
    expect(updates("t1")).toHaveLength(0);
  });

  it("refuses to save a log over bb's 256 KiB metadata limit", async () => {
    const { store, updates } = createHost();

    await expect(
      store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: ["x".repeat(300 * 1024)] }),
    ).rejects.toThrow(/256 KiB/);
    expect(updates("t1")).toHaveLength(0);
  });

  it("still clears quests when undo snapshots would push the thread past bb's limit", async () => {
    const { store, saved } = createHost();
    const kib = (size: number, letter: string) => letter.repeat(size * 1024);
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: [kib(50, "b")] });
    await store.runTool("t1", { type: QUEST_ACTIONS.add, descriptions: [kib(60, "a")] });
    await store.runTool("t1", { type: QUEST_ACTIONS.toggle, id: "02" });
    await store.runTool("t1", {
      type: QUEST_ACTIONS.update,
      id: "02",
      description: kib(60, "c"),
    });

    const cleared = await store.runTool("t1", { type: QUEST_ACTIONS.clear });

    expect(cleared).toEqual({ text: "Cleared 1 completed quests", isError: false });
    expect(Buffer.byteLength(JSON.stringify(saved("t1")))).toBeLessThanOrEqual(
      METADATA_LIMIT_BYTES,
    );
    expect((saved("t1")?.log as QuestLogState).history.map(({ type }) => type)).toEqual(["clear"]);
    expect((await store.runTool("t1", { type: QUEST_ACTIONS.undo })).isError).toBe(false);
    expect(await descriptions(store, "t1")).toEqual([kib(50, "b"), kib(60, "c")]);
  });

  it("keeps the newest 50 panel changes for the agent and counts the rest", async () => {
    const { store, saved } = createHost();
    const pending = () => saved("t1")?.pendingUserChanges as string[];
    for (let index = 1; index <= 51; index++) {
      await store.mutate("t1", { type: QUEST_ACTIONS.add, descriptions: [`Quest ${index}`] });
    }
    expect(pending().at(-1)).toBe("and 1 earlier change");

    await store.mutate("t1", { type: QUEST_ACTIONS.add, descriptions: ["Quest 52"] });

    expect(pending()).toHaveLength(51);
    expect(pending()[0]).toBe("Added quest [03]: Quest 3");
    expect(pending().at(-1)).toBe("and 2 earlier changes");
    const { text } = await store.runTool("t1", { type: QUEST_ACTIONS.list });
    const notice = text.split("\n\n")[0]!.split("\n");
    expect(notice).toHaveLength(52);
    expect(notice[1]).toBe("- Added quest [03]: Quest 3");
    expect(notice.slice(-2)).toEqual(["- Added quest [34]: Quest 52", "- and 2 earlier changes"]);
  });
});

describe("fitting bb's 256 KiB metadata limit", () => {
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  const toggle: HistoryEntry = { type: "toggle", ids: ["01"] };
  const update: HistoryEntry = { type: "update", id: "01", previousDescription: "Newest" };
  const redo: RedoEntry = { type: "toggle", ids: ["01"] };
  const note = (index: number) => `Added quest [0${index}]: ${"n".repeat(40)}`;

  // A done quest stays out of progress.current, so each description character adds one byte.
  function state(
    length: number,
    history: HistoryEntry[] = [],
    redoStack: RedoEntry[] = [],
  ): QuestLogState {
    const quest = { id: "01", description: "x".repeat(length), done: true, createdAt: 1 };
    return { version: 1, quests: [quest], steps: [], usedIds: ["01"], history, redoStack };
  }

  // The description length that brings the namespace to exactly the limit.
  function filling(history: HistoryEntry[], redoStack: RedoEntry[], notes: string[] = []) {
    return METADATA_LIMIT_BYTES - bytes(fitQuestsMetadata(state(0, history, redoStack), notes));
  }

  it("keeps everything when the namespace is exactly the limit", () => {
    const history = [toggle, update];

    const fitted = fitQuestsMetadata(state(filling(history, [redo]), history, [redo]), []);

    expect(bytes(fitted)).toBe(METADATA_LIMIT_BYTES);
    expect(fitted.log.history).toEqual(history);
    expect(fitted.log.redoStack).toEqual([redo]);
  });

  it("drops the oldest undo entry when the namespace is one byte over", () => {
    const history = [toggle, update];

    const fitted = fitQuestsMetadata(state(filling(history, []) + 1, history), []);

    expect(fitted.log.history).toEqual([update]);
    expect(bytes(fitted)).toBeLessThanOrEqual(METADATA_LIMIT_BYTES);
  });

  it("drops from the longer stack first", () => {
    const redoStack: RedoEntry[] = [{ type: "update", id: "01", description: "Deepest" }, redo];

    const fitted = fitQuestsMetadata(
      state(filling([update], redoStack) + 1, [update], redoStack),
      [],
    );

    expect(fitted.log.history).toEqual([update]);
    expect(fitted.log.redoStack).toEqual([redo]);
  });

  it("folds the oldest pending notes once both stacks are empty", () => {
    const notes = [note(1), note(2)];

    const fitted = fitQuestsMetadata(state(filling([], [], notes) + 1), notes);

    expect(fitted.pendingUserChanges).toEqual([note(2), "and 1 earlier change"]);
    expect(bytes(fitted)).toBeLessThanOrEqual(METADATA_LIMIT_BYTES);
  });

  it("fails only when the quests alone are over the limit", () => {
    expect(bytes(fitQuestsMetadata(state(filling([], [])), []))).toBe(METADATA_LIMIT_BYTES);
    expect(() => fitQuestsMetadata(state(filling([], []) + 1), [])).toThrow(
      /over bb's 256 KiB limit/,
    );
  });
});

describe("quest store forks", () => {
  it("copies the source log into a fork without its pending notices", async () => {
    const { store, saved } = createHost({ threads: [forkThread] });
    await store.runTool("source", { type: QUEST_ACTIONS.add, descriptions: ["Shared"] });
    await store.mutate("source", { type: QUEST_ACTIONS.add, descriptions: ["From the panel"] });

    await store.copyFork(forkThread);

    expect(saved("fork")).toEqual({ ...saved("source"), pendingUserChanges: [] });
    await store.runTool("fork", { type: QUEST_ACTIONS.add, descriptions: ["Fork only"] });
    expect(await descriptions(store, "source")).toEqual(["Shared", "From the panel"]);
    expect(await descriptions(store, "fork")).toEqual(["Shared", "From the panel", "Fork only"]);
  });

  it("gives a side chat its own empty log", async () => {
    const { store, saved } = createHost({ threads: [sideChatThread] });
    await store.runTool("source", { type: QUEST_ACTIONS.add, descriptions: ["Main thread"] });

    await store.copyFork(sideChatThread);

    expect(saved("side")).toBeUndefined();
    expect(await descriptions(store, "side")).toEqual([]);
  });

  it("does not overwrite a fork that already has quests", async () => {
    const { store } = createHost({ threads: [forkThread] });
    await store.runTool("source", { type: QUEST_ACTIONS.add, descriptions: ["Source"] });
    await store.copyFork(forkThread);
    await store.runTool("fork", { type: QUEST_ACTIONS.add, descriptions: ["Fork"] });

    await store.copyFork(forkThread);

    expect(await descriptions(store, "fork")).toEqual(["Source", "Fork"]);
  });

  it("copies a fork on its first read when the created event never arrived", async () => {
    const { store } = createHost({ threads: [forkThread] });
    await store.runTool("source", { type: QUEST_ACTIONS.add, descriptions: ["Source"] });

    expect(await descriptions(store, "fork")).toEqual(["Source"]);
  });

  it("copies a fork once when the created event races its first read", async () => {
    const { store, updates } = createHost({ delayMs: 5, threads: [forkThread] });
    await store.runTool("source", { type: QUEST_ACTIONS.add, descriptions: ["Source"] });

    const [view] = await Promise.all([store.getLog("fork"), store.copyFork(forkThread)]);

    expect(view.quests.map((quest) => quest.description)).toEqual(["Source"]);
    expect(updates("fork")).toHaveLength(1);
  });

  it("keeps a fork of an empty source empty when the source gains quests later", async () => {
    const { store } = createHost({ threads: [forkThread] });

    await store.copyFork(forkThread);
    await store.runTool("source", { type: QUEST_ACTIONS.add, descriptions: ["After the fork"] });

    expect(await descriptions(store, "fork")).toEqual([]);
  });
});
