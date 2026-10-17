// @vitest-environment jsdom
import type { PluginThreadHeaderActionProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import { loadPluginApp, type RenderedSlot, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { rpcContract } from "../../extensions/bb/server.js";
import type { QuestMutation, QuestView } from "../../extensions/bb/store.js";
import { questProgress } from "../../src/quest/progress.js";
import type { Quest, Step } from "../../src/quest/types.js";

const slots: RenderedSlot[] = [];
afterEach(() => {
  for (const slot of slots.splice(0)) slot.lifecycle.unmount();
});

const parent: Quest = { id: "01", description: "Parent", done: false, createdAt: 1 };
const child: Step = { id: "02", description: "Child", done: false, createdAt: 2, parentId: "01" };
const other: Quest = { id: "03", description: "Other", done: true, createdAt: 3 };

function viewOf(...quests: (Quest | Step)[]): QuestView {
  return { quests, progress: questProgress(quests) };
}

const EMPTY = viewOf();
const LOG = viewOf(parent, child, other);

async function loadApp() {
  return loadPluginApp(() => import("../../extensions/bb/app.js"));
}

function hold<T>(queue: Promise<T>[]): (value: T) => void {
  let release!: (value: T) => void;
  queue.push(
    new Promise<T>((resolve) => {
      release = resolve;
    }),
  );
  return release;
}

/*
 * getLog answers with the current view and mutate with the view set by `changesReturn`, so a test
 * sees a change's result only if the panel renders what mutate returned. `holdGetLog` and
 * `holdMutate` keep the next call open until the returned function releases it.
 */
function backend(initial: QuestView) {
  let view = initial;
  let changed = initial;
  const heldGetLogs: Promise<QuestView>[] = [];
  const heldMutates: Promise<void>[] = [];
  const mutations: QuestMutation[] = [];
  return {
    mutations,
    setView: (next: QuestView) => {
      view = next;
    },
    changesReturn: (next: QuestView) => {
      changed = next;
    },
    holdGetLog: () => hold(heldGetLogs),
    holdMutate: () => hold(heldMutates),
    rpc: {
      getLog: () => heldGetLogs.shift() ?? view,
      mutate: async ({ action }: { action: QuestMutation }) => {
        mutations.push(action);
        await heldMutates.shift();
        return { message: "ok", view: changed };
      },
    },
  };
}

async function renderPanel(server: ReturnType<typeof backend>) {
  const app = await loadApp();
  const panel = app.threadPanelActions[0];
  if (!panel) throw new Error("quests panel is not registered");
  const slot = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
    panel,
    { threadId: "t1", params: null },
    { rpc: server.rpc },
  );
  slots.push(slot);
  return slot;
}

async function renderChip(server: ReturnType<typeof backend>, isCompactViewport = false) {
  const app = await loadApp();
  const chip = app.threadHeaderActions[0];
  if (!chip) throw new Error("quest chip is not registered");
  const slot = renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(
    chip,
    { threadId: "t1", projectId: "p1", isCompactViewport },
    { rpc: server.rpc, openThreadPanel: () => true },
  );
  slots.push(slot);
  return slot;
}

function button(slot: RenderedSlot, name: string): HTMLButtonElement {
  return slot.getByRole("button", { name }) as HTMLButtonElement;
}

function getLogCalls(slot: RenderedSlot): number {
  return slot.inspection.rpcCalls.filter(({ method }) => method === "getLog").length;
}

async function settled(slot: RenderedSlot): Promise<void> {
  await waitFor(() => expect(button(slot, "Undo").disabled).toBe(false));
}

describe("quests app registration", () => {
  it("registers the Quests tab and the progress chip", async () => {
    const app = await loadApp();

    expect(app.threadPanelActions.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "quests", title: "Quests" },
    ]);
    expect(app.threadHeaderActions.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "quests-progress", title: "Quest progress" },
    ]);
  });
});

describe("Quests tab", () => {
  it("shows an empty state for a thread without quests", async () => {
    const slot = await renderPanel(backend(EMPTY));

    expect(await slot.findByText(/No quests yet/)).toBeTruthy();
    expect(slot.inspection.rpcCalls).toEqual([{ method: "getLog", input: { threadId: "t1" } }]);
  });

  it("nests steps under their parent quest", async () => {
    const slot = await renderPanel(backend(LOG));

    const steps = await slot.findByRole("list", { name: 'Steps of "Parent"' });
    expect(steps.textContent).toContain("Child");
    expect(slot.getByRole("list", { name: "Quest list" }).children).toHaveLength(2);
    expect(slot.getByText("1 of 3 done")).toBeTruthy();
  });

  it("adds a quest and shows the log the change returned", async () => {
    const server = backend(EMPTY);
    server.changesReturn(
      viewOf({ id: "01", description: "Write docs", done: false, createdAt: 1 }),
    );
    const slot = await renderPanel(server);
    const input = (await slot.findByRole("textbox", { name: "New quest" })) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "  Write docs  " } });
    fireEvent.click(button(slot, "Add"));

    expect(await slot.findByText("Write docs")).toBeTruthy();
    expect(server.mutations).toEqual([{ type: "add", descriptions: ["Write docs"] }]);
    expect(input.value).toBe("");
    expect(getLogCalls(slot)).toBe(1);
  });

  it("toggles, edits and adds steps, rendering each change's result", async () => {
    const server = backend(LOG);
    const slot = await renderPanel(server);
    const finished = { ...child, done: true };
    const renamed = { ...parent, description: "Renamed" };
    const added: Step = {
      id: "04",
      description: "New step",
      done: false,
      createdAt: 4,
      parentId: "01",
    };

    server.changesReturn(viewOf(parent, finished, other));
    fireEvent.click(await slot.findByRole("checkbox", { name: 'Mark "Child" done' }));
    expect(await slot.findByRole("checkbox", { name: 'Mark "Child" not done' })).toBeTruthy();

    server.changesReturn(viewOf(renamed, finished, other));
    fireEvent.click(button(slot, 'Edit "Parent"'));
    fireEvent.change(slot.getByRole("textbox", { name: 'Edit "Parent"' }), {
      target: { value: "Renamed" },
    });
    fireEvent.click(button(slot, "Save"));
    expect(await slot.findByText("Renamed")).toBeTruthy();

    server.changesReturn(viewOf(renamed, finished, added, other));
    fireEvent.click(button(slot, 'Add a step to "Renamed"'));
    fireEvent.change(slot.getByRole("textbox", { name: 'New step for "Renamed"' }), {
      target: { value: "New step" },
    });
    fireEvent.submit(slot.getByRole("textbox", { name: 'New step for "Renamed"' }));
    expect(await slot.findByText("New step")).toBeTruthy();

    expect(server.mutations).toEqual([
      { type: "toggle", id: "02" },
      { type: "update", id: "01", description: "Renamed" },
      { type: "split", id: "01", descriptions: ["New step"] },
    ]);
  });

  it("cancels an edit with Escape", async () => {
    const server = backend(LOG);
    const slot = await renderPanel(server);

    fireEvent.click(await slot.findByRole("button", { name: 'Edit "Other"' }));
    fireEvent.keyDown(slot.getByRole("textbox", { name: 'Edit "Other"' }), { key: "Escape" });

    expect(slot.queryByRole("textbox", { name: 'Edit "Other"' })).toBeNull();
    expect(server.mutations).toEqual([]);
  });

  it("deletes only after confirmation, taking a parent's steps with it", async () => {
    const server = backend(LOG);
    const slot = await renderPanel(server);

    fireEvent.click(await slot.findByRole("button", { name: 'Delete "Other"' }));
    expect(server.mutations).toEqual([]);
    server.changesReturn(viewOf(parent, child));
    fireEvent.click(button(slot, 'Confirm deleting "Other"'));
    await waitFor(() => expect(slot.queryByText("Other")).toBeNull());

    fireEvent.click(button(slot, 'Delete "Parent"'));
    expect(slot.getByText("Delete with 1 steps?")).toBeTruthy();
    server.changesReturn(EMPTY);
    fireEvent.click(button(slot, 'Confirm deleting "Parent"'));

    expect(await slot.findByText(/No quests yet/)).toBeTruthy();
    expect(server.mutations).toEqual([
      { type: "delete", id: "03" },
      { type: "delete", ids: ["01", "02"] },
    ]);
  });

  it("moves quests with the engine's insert-before reorder", async () => {
    const server = backend(viewOf(parent, other));
    const slot = await renderPanel(server);
    const firstQuest = () =>
      slot.getByRole("list", { name: "Quest list" }).children[0]?.textContent;

    expect(
      (await slot.findByRole("button", { name: 'Move "Parent" up' })).hasAttribute("disabled"),
    ).toBe(true);
    server.changesReturn(viewOf(other, parent));
    fireEvent.click(button(slot, 'Move "Parent" down'));
    await waitFor(() => expect(firstQuest()).toContain("Other"));

    server.changesReturn(viewOf(parent, other));
    fireEvent.click(button(slot, 'Move "Parent" up'));
    await waitFor(() => expect(firstQuest()).toContain("Parent"));

    expect(server.mutations).toEqual([
      { type: "reorder", id: "03", targetId: "01" },
      { type: "reorder", id: "01", targetId: "03" },
    ]);
  });

  it("undoes, redoes and clears done quests", async () => {
    const server = backend(LOG);
    const slot = await renderPanel(server);

    fireEvent.click(await slot.findByRole("button", { name: "Undo" }));
    await settled(slot);
    fireEvent.click(button(slot, "Redo"));
    await settled(slot);
    server.changesReturn(viewOf(parent, child));
    fireEvent.click(button(slot, "Clear done"));

    await waitFor(() => expect(slot.queryByText("Other")).toBeNull());
    expect(server.mutations).toEqual([{ type: "undo" }, { type: "redo" }, { type: "clear" }]);
  });

  it("accepts one change at a time and disables the controls meanwhile", async () => {
    const server = backend(LOG);
    const release = server.holdMutate();
    const slot = await renderPanel(server);
    const input = await slot.findByRole("textbox", { name: "New quest" });

    fireEvent.change(input, { target: { value: "Once" } });
    fireEvent.submit(input);
    fireEvent.submit(input);
    fireEvent.click(button(slot, "Undo"));

    await waitFor(() =>
      expect(server.mutations).toEqual([{ type: "add", descriptions: ["Once"] }]),
    );
    for (const name of ["Add", "Undo", "Redo", "Clear done", 'Move "Parent" down']) {
      expect(button(slot, name).disabled, name).toBe(true);
    }
    const checkbox = slot.getByRole("checkbox", { name: 'Mark "Child" done' }) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);

    await act(async () => release());
    await settled(slot);
    expect(server.mutations).toHaveLength(1);
  });

  it("shows a rejected change as an alert", async () => {
    const server = backend(LOG);
    server.rpc.mutate = () => {
      throw new Error("Nothing to undo.");
    };
    const slot = await renderPanel(server);

    fireEvent.click(await slot.findByRole("button", { name: "Undo" }));

    expect((await slot.findByRole("alert")).textContent).toContain("Nothing to undo.");
  });

  it("keeps the view a change returned when an older getLog answers late", async () => {
    const server = backend(EMPTY);
    const slot = await renderPanel(server);
    await slot.findByText(/No quests yet/);
    const answerLate = server.holdGetLog();
    await slot.behavior.emitRealtime("quests", { threadId: "t1" });

    server.changesReturn(viewOf(parent));
    const input = slot.getByRole("textbox", { name: "New quest" });
    fireEvent.change(input, { target: { value: "Parent" } });
    fireEvent.submit(input);
    expect(await slot.findByText("Parent")).toBeTruthy();
    await act(async () => answerLate(EMPTY));

    expect(slot.queryByText("Parent")).not.toBeNull();
  });

  it("ignores a getLog answer that a newer getLog overtook", async () => {
    const server = backend(EMPTY);
    const slot = await renderPanel(server);
    await slot.findByText(/No quests yet/);
    const answerLate = server.holdGetLog();
    await slot.behavior.emitRealtime("quests", { threadId: "t1" });

    server.setView(LOG);
    await slot.behavior.emitRealtime("quests", { threadId: "t1" });
    expect(await slot.findByText("Parent")).toBeTruthy();
    await act(async () => answerLate(EMPTY));

    expect(slot.queryByText("Parent")).not.toBeNull();
  });

  it("refetches only for its own thread's realtime signals", async () => {
    const server = backend(EMPTY);
    const slot = await renderPanel(server);
    await slot.findByText(/No quests yet/);

    server.setView(LOG);
    await slot.behavior.emitRealtime("quests", { threadId: "other" });
    expect(slot.queryByText("Parent")).toBeNull();
    await slot.behavior.emitRealtime("quests", { threadId: "t1" });

    expect(await slot.findByText("Parent")).toBeTruthy();
    expect(getLogCalls(slot)).toBe(2);
  });

  it("refetches when the realtime connection comes back, since missed signals are not replayed", async () => {
    const server = backend(EMPTY);
    const slot = await renderPanel(server);
    await slot.findByText(/No quests yet/);

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    server.setView(LOG);
    expect(getLogCalls(slot)).toBe(1);
    await slot.behavior.setRealtimeConnectionState("connected");

    expect(await slot.findByText("Parent")).toBeTruthy();
    expect(getLogCalls(slot)).toBe(2);
  });
});

describe("quest progress chip", () => {
  it("is muted and says quests while the thread has none", async () => {
    const slot = await renderChip(backend(EMPTY));

    const chip = await slot.findByRole("button", { name: "No quests yet. Open quests" });
    expect(chip.textContent).toBe("quests");
    expect(chip.className).toContain("text-muted-foreground");
  });

  it("drops the label at compact widths", async () => {
    const slot = await renderChip(backend(EMPTY), true);

    expect(
      (await slot.findByRole("button", { name: "No quests yet. Open quests" })).textContent,
    ).toBe("");
  });

  it("shows quest and step progress and refreshes on its thread's signal", async () => {
    const server = backend(LOG);
    const slot = await renderChip(server);

    const chip = await slot.findByRole("button", {
      name: "1 of 3 quests done, next: Parent. Open quests",
    });
    expect(chip.textContent).toBe("1/3");

    server.setView({ ...LOG, progress: { done: 3, total: 3, current: null } });
    await slot.behavior.emitRealtime("quests", { threadId: "other" });
    expect(chip.textContent).toBe("1/3");
    await slot.behavior.emitRealtime("quests", { threadId: "t1" });
    await waitFor(() => expect(chip.textContent).toBe("3/3"));
  });

  it("opens the Quests tab", async () => {
    const slot = await renderChip(backend(LOG));

    fireEvent.click(await slot.findByRole("button", { name: /Open quests$/ }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "quests" } },
    ]);
  });
});
