// @vitest-environment jsdom
import type {
  ComposerSendMenuItem,
  ExperimentalComposerPopupRegistration,
  ExperimentalThreadContextSegmentProps,
  ExperimentalThreadContextSegmentRegistration,
  ExperimentalThreadInfoProps,
  PluginComposerApi,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk";
import {
  type CapturedPluginApp,
  loadPluginApp,
  type RenderedSlot,
  type RenderSlotOptions,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { rpcContract } from "../../extensions/bb/server.js";
import type { QuestMutation, QuestView } from "../../extensions/bb/store.js";
import { questProgress } from "../../src/quest/progress.js";
import type { Quest, Step } from "../../src/quest/types.js";

const slots: RenderedSlot[] = [];
afterEach(() => {
  for (const slot of slots.splice(0)) slot.lifecycle.unmount();
  vi.useRealTimers();
});

const parent: Quest = { id: "01", description: "Parent", done: false, createdAt: 1 };
const child: Step = { id: "02", description: "Child", done: false, createdAt: 2, parentId: "01" };
const other: Quest = { id: "03", description: "Other", done: true, createdAt: 3 };

function viewOf(
  quests: (Quest | Step)[],
  extra: Partial<Pick<QuestView, "agentChangedAt" | "unseenChanges">> = {},
): QuestView {
  return {
    quests,
    progress: questProgress(quests),
    agentChangedAt: null,
    unseenChanges: 0,
    ...extra,
  };
}

const EMPTY = viewOf([]);
const LOG = viewOf([parent, child, other]);

async function loadApp(): Promise<CapturedPluginApp> {
  return loadPluginApp(() => import("../../extensions/bb/app.js"));
}

/*
 * A stand-in for the server: getLog answers with the current view, and a change makes the view
 * `next` (the current one when unset), as the real server's log would after the change.
 */
function backend(initial: QuestView) {
  let view = initial;
  let next: QuestView | null = null;
  const mutations: QuestMutation[] = [];
  const tells: string[] = [];
  return {
    mutations,
    tells,
    changesTo: (changed: QuestView) => {
      next = changed;
    },
    setView: (changed: QuestView) => {
      view = changed;
    },
    rpc: {
      getLog: () => view,
      mutate: ({ action }: { action: QuestMutation }) => {
        mutations.push(action);
        if (action.type === "update" && action.description === "boom") {
          throw new Error("Quest [01] not found.");
        }
        view = next ?? view;
        next = null;
        return { message: "ok", view };
      },
      tell: ({ threadId }: { threadId: string }) => {
        tells.push(threadId);
        view = { ...view, unseenChanges: 0 };
        return { sent: true };
      },
    },
  };
}

type Server = ReturnType<typeof backend>;

function threadsState(
  status: "active" | "idle",
  providerId = "pi",
): Partial<PluginSidebarThreadsState> {
  return {
    threads: [{ id: "t1", status, providerId } as PluginSidebarThreadsState["threads"][number]],
  };
}

function render<Props extends object>(
  component: ComponentType<Props>,
  props: Props,
  server: Server,
  options: Omit<RenderSlotOptions<typeof rpcContract>, "rpc"> = {},
) {
  const slot = renderSlot<Props, typeof rpcContract>({ component }, props, {
    rpc: server.rpc,
    openThreadPanel: () => true,
    ...options,
  });
  slots.push(slot);
  return slot;
}

async function renderTab(
  server: Server,
  options: Omit<RenderSlotOptions<typeof rpcContract>, "rpc"> = {},
) {
  const app = await loadApp();
  const tab = app.tabs.find((entry) => entry.id === "quests") as
    | { component: ComponentType<{ threadId: string; params: null }> }
    | undefined;
  if (!tab) throw new Error("the Quests tab is not registered");
  return render(tab.component, { threadId: "t1", params: null }, server, options);
}

async function segment(): Promise<ExperimentalThreadContextSegmentRegistration> {
  const app = await loadApp();
  const [registration] = app.threadContextSegments;
  if (!registration) throw new Error("the quests segment is not registered");
  return registration;
}

function segmentProps(
  overrides: Partial<ExperimentalThreadContextSegmentProps> = {},
): ExperimentalThreadContextSegmentProps {
  return {
    threadId: "t1",
    projectId: "p1",
    environment: null,
    segments: [{ key: "pi-quests/quests", pluginId: "pi-quests" }],
    isExpanded: false,
    onToggle: () => {},
    ...overrides,
  };
}

function button(slot: RenderedSlot, name: string | RegExp): HTMLButtonElement {
  return slot.getByRole("button", { name }) as HTMLButtonElement;
}

function getLogCalls(slot: RenderedSlot): number {
  return slot.inspection.rpcCalls.filter(({ method }) => method === "getLog").length;
}

describe("quests app registration", () => {
  it("registers the tab, the context segment, the Info row, the send menu item and a command", async () => {
    const app = await loadApp();

    expect(
      app.tabs.map(({ id, title, context, availability }) => ({
        id,
        title,
        context,
        availability,
      })),
    ).toEqual([
      { id: "quests", title: "Quests", context: { kind: "thread" }, availability: "action" },
    ]);
    expect(
      app.threadContextSegments.map(({ id, title, group, order }) => ({ id, title, group, order })),
    ).toEqual([{ id: "quests", title: "Quests", group: "1_thread", order: 20 }]);
    expect(app.threadInfoRows.map(({ id, group }) => ({ id, group }))).toEqual([
      { id: "quests", group: "1_thread" },
    ]);
    const [composer] = app.composerCustomizations;
    expect(composer?.scopes).toEqual(["thread"]);
    expect(composer?.actions).toBeUndefined();
    expect(composer?.sendMenu?.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "add-as-quest", label: "Add as a quest" },
    ]);
    expect(app.threadHeaderActions).toEqual([]);
  });

  it("opens the Quests tab from a command in a thread only", async () => {
    type Command = {
      id: string;
      defaultShortcut?: unknown;
      isAvailable?: (context: { threadId: string | null }) => boolean;
      run: (context: { openPanel: (options: { actionId: string }) => boolean }) => void;
    };
    const commands: Command[] = [];
    const { default: definition } = await import("../../extensions/bb/app.js");
    // The capture harness does not collect commands, so run setup against a recording builder.
    definition.setup({
      slots: new Proxy({}, { get: () => () => {} }),
      composer: { customize: () => {} },
      commands: { register: (command: Command) => commands.push(command) },
    } as never);
    const [command] = commands;
    const openPanel = vi.fn(() => true);

    expect(command?.id).toBe("open-quests");
    expect(command?.defaultShortcut).toEqual({ key: "l", mod: true, shift: true });
    expect(command?.isAvailable?.({ threadId: null })).toBe(false);
    expect(command?.isAvailable?.({ threadId: "t1" })).toBe(true);
    command?.run({ openPanel });
    expect(openPanel).toHaveBeenCalledWith({ actionId: "quests" });
  });
});

describe("Quests tab", () => {
  it("shows an empty state for a thread without quests", async () => {
    const slot = await renderTab(backend(EMPTY));

    expect(await slot.findByText(/No quests yet/)).toBeTruthy();
    expect(getLogCalls(slot)).toBe(1);
  });

  it("nests steps, marks the next item and folds the done quests away", async () => {
    const slot = await renderTab(backend(LOG));

    const steps = await slot.findByRole("list", { name: 'Steps of "Parent"' });
    expect(steps.textContent).toContain("Child");
    expect(steps.textContent).toContain("Next");
    expect(slot.getByText("1 of 3 done")).toBeTruthy();
    expect(slot.getByRole("list", { name: "Quest list" }).textContent).not.toContain("Other");

    fireEvent.click(button(slot, /Done · 1/));
    expect(slot.getByRole("list", { name: "Done quests" }).textContent).toContain("Other");
  });

  it("adds a quest and shows the refreshed log", async () => {
    const server = backend(EMPTY);
    server.changesTo(viewOf([{ id: "01", description: "Write docs", done: false, createdAt: 1 }]));
    const slot = await renderTab(server);
    const input = (await slot.findByRole("textbox", { name: "New quest" })) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "  Write docs  " } });
    fireEvent.click(button(slot, "Add"));

    expect(await slot.findByText("Write docs")).toBeTruthy();
    expect(server.mutations).toEqual([{ type: "add", descriptions: ["Write docs"] }]);
    expect(input.value).toBe("");
  });

  it("toggles, edits and adds steps", async () => {
    const server = backend(LOG);
    const slot = await renderTab(server);
    const finished = { ...child, done: true };
    const renamed = { ...parent, description: "Renamed" };

    server.changesTo(viewOf([parent, finished, other]));
    fireEvent.click(await slot.findByRole("checkbox", { name: 'Mark "Child" done' }));
    expect(await slot.findByRole("checkbox", { name: 'Mark "Child" not done' })).toBeTruthy();

    server.changesTo(viewOf([renamed, finished, other]));
    fireEvent.click(button(slot, 'Edit "Parent"'));
    fireEvent.change(slot.getByRole("textbox", { name: 'Edit "Parent"' }), {
      target: { value: "Renamed" },
    });
    fireEvent.click(button(slot, "Save"));
    expect(await slot.findByText("Renamed")).toBeTruthy();

    fireEvent.click(button(slot, 'Add a step to "Renamed"'));
    fireEvent.change(slot.getByRole("textbox", { name: 'New step for "Renamed"' }), {
      target: { value: "New step" },
    });
    fireEvent.submit(slot.getByRole("textbox", { name: 'New step for "Renamed"' }));

    await waitFor(() =>
      expect(server.mutations).toEqual([
        { type: "toggle", id: "02" },
        { type: "update", id: "01", description: "Renamed" },
        { type: "split", id: "01", descriptions: ["New step"] },
      ]),
    );
  });

  it("deletes only after confirmation, taking a parent's steps with it", async () => {
    const server = backend(LOG);
    const slot = await renderTab(server);

    fireEvent.click(await slot.findByRole("button", { name: 'Delete "Parent"' }));
    expect(slot.getByText("Delete with 1 steps?")).toBeTruthy();
    fireEvent.click(button(slot, 'Confirm deleting "Parent"'));

    await waitFor(() => expect(server.mutations).toEqual([{ type: "delete", ids: ["01", "02"] }]));
  });

  it("moves open quests past each other with the engine's insert-before reorder", async () => {
    const second: Quest = { id: "04", description: "Second", done: false, createdAt: 4 };
    const server = backend(viewOf([parent, other, second]));
    const slot = await renderTab(server);

    await slot.findByRole("button", { name: 'Move "Parent" down' });
    expect(button(slot, 'Move "Parent" up').disabled).toBe(true);
    fireEvent.click(button(slot, 'Move "Parent" down'));
    await waitFor(() => expect(server.mutations).toHaveLength(1));
    fireEvent.click(button(slot, 'Move "Second" up'));

    await waitFor(() =>
      expect(server.mutations).toEqual([
        { type: "reorder", id: "04", targetId: "01" },
        { type: "reorder", id: "04", targetId: "01" },
      ]),
    );
  });

  it("undoes, redoes and clears done quests", async () => {
    const server = backend(LOG);
    const slot = await renderTab(server);

    fireEvent.click(await slot.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.mutations).toHaveLength(1));
    fireEvent.click(button(slot, "Redo"));
    await waitFor(() => expect(server.mutations).toHaveLength(2));
    fireEvent.click(button(slot, "Clear done"));

    await waitFor(() =>
      expect(server.mutations).toEqual([{ type: "undo" }, { type: "redo" }, { type: "clear" }]),
    );
  });

  it("shows a rejected change as an alert", async () => {
    const slot = await renderTab(backend(LOG));

    fireEvent.click(await slot.findByRole("button", { name: 'Edit "Parent"' }));
    fireEvent.change(slot.getByRole("textbox", { name: 'Edit "Parent"' }), {
      target: { value: "boom" },
    });
    fireEvent.click(button(slot, "Save"));

    expect((await slot.findByRole("alert")).textContent).toContain("not found");
  });

  it("refreshes when the server invalidates its thread's quests", async () => {
    const server = backend(EMPTY);
    const slot = await renderTab(server);
    await slot.findByText(/No quests yet/);

    server.setView(LOG);
    await slot.behavior.experimental_invalidateRpc(["quests:t1"]);

    expect(await slot.findByText("Parent")).toBeTruthy();
  });

  it("says when the agent last changed the log, and warns once a working agent goes quiet", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: 60 * 60_000 });
    const server = backend(viewOf([parent, child], { agentChangedAt: 60 * 60_000 - 3 * 60_000 }));
    const slot = await renderTab(server, { sidebarThreads: threadsState("active") });

    expect(await slot.findByText("The agent last changed the log 3 min ago.")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(11 * 60_000);
    });

    expect(
      await slot.findByText("The agent last changed the log 14 min ago and is still working."),
    ).toBeTruthy();
  });

  it("offers Tell it now for unseen changes while a steerable agent works", async () => {
    const server = backend(viewOf([parent], { unseenChanges: 2 }));
    const slot = await renderTab(server, { sidebarThreads: threadsState("active") });

    expect(await slot.findByText("2 changes the agent hasn't seen yet.")).toBeTruthy();
    fireEvent.click(button(slot, "Tell it now"));

    await waitFor(() => expect(server.tells).toEqual(["t1"]));
    await waitFor(() => expect(slot.queryByRole("button", { name: "Tell it now" })).toBeNull());
  });

  it("explains when unseen changes reach an idle agent instead", async () => {
    const slot = await renderTab(backend(viewOf([parent], { unseenChanges: 1 })), {
      sidebarThreads: threadsState("idle"),
    });

    expect(
      await slot.findByText(
        "1 change the agent hasn't seen. It sees them with your next message or its next quest call.",
      ),
    ).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Tell it now" })).toBeNull();
  });
});

describe("quests segment above the composer", () => {
  async function visibility(view: QuestView): Promise<string> {
    const { useVisible } = await segment();
    const Probe = () => (
      <span>{String(useVisible?.({ threadId: "t1", projectId: "p1", environment: null }))}</span>
    );
    const slot = render(Probe, {}, backend(view));
    await waitFor(() => expect(getLogCalls(slot)).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return slot.container.textContent ?? "";
  }

  it("shows only while a quest is open or the agent has unseen changes", async () => {
    expect(await visibility(EMPTY)).toBe("false");
    expect(await visibility(viewOf([other]))).toBe("false");
    expect(await visibility(viewOf([other], { unseenChanges: 1 }))).toBe("true");
    expect(await visibility(LOG)).toBe("true");
  });

  it("names the next item when the row has room, and toggles on click", async () => {
    const { summary } = await segment();
    const onToggle = vi.fn();
    const slot = render(summary, segmentProps({ onToggle }), backend(LOG));

    const toggle = await slot.findByRole("button", {
      name: /^Quests: 1 of 3 quests done, next: Child/,
    });
    expect(toggle.textContent).toBe("1/3·Child");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shrinks to the count in a crowded row", async () => {
    const { summary } = await segment();
    const crowded = [
      "bb--core/parent-thread",
      "pi-quests/quests",
      "shuttle/pull-requests",
      "bb--core/changed-files",
    ];
    const slot = render(
      summary,
      segmentProps({ segments: crowded.map((key) => ({ key, pluginId: key.split("/")[0]! })) }),
      backend(LOG),
    );

    expect((await slot.findByRole("button", { name: /^Quests:/ })).textContent).toBe("1/3");
  });

  it("marks unseen changes in the summary", async () => {
    const { summary } = await segment();
    const slot = render(summary, segmentProps(), backend(viewOf([parent], { unseenChanges: 3 })));

    expect(
      (await slot.findByRole("button", { name: /^Quests:/ })).getAttribute("aria-label"),
    ).toContain("3 of your changes not seen by the agent");
  });

  it("renders no details while collapsed", async () => {
    const { details } = await segment();
    if (!details) throw new Error("no details");
    const slot = render(details, segmentProps(), backend(LOG));
    await waitFor(() => expect(getLogCalls(slot)).toBe(1));

    expect(slot.container.textContent).toBe("");
  });

  it("lists open quests and the current quest's open steps, and ticks them", async () => {
    const steps: Step[] = ["A", "B", "C", "D", "E"].map((name, index) => ({
      id: `1${index}`,
      description: name,
      done: false,
      createdAt: 10 + index,
      parentId: "01",
    }));
    const server = backend(viewOf([parent, ...steps, other]));
    const { details } = await segment();
    if (!details) throw new Error("no details");
    const slot = render(details, segmentProps({ isExpanded: true }), server);

    const open = await slot.findByRole("list", { name: "Open quests" });
    expect(open.textContent).toContain("Parent0/5");
    expect(open.textContent).toContain("ANext");
    expect(open.textContent).toContain("+2 more steps");
    expect(open.textContent).toContain("1 done");
    fireEvent.click(slot.getByRole("checkbox", { name: 'Mark "A" done' }));

    await waitFor(() => expect(server.mutations).toEqual([{ type: "toggle", id: "10" }]));
  });

  it("adds a quest and opens the Quests tab", async () => {
    const server = backend(LOG);
    const { details } = await segment();
    if (!details) throw new Error("no details");
    const slot = render(details, segmentProps({ isExpanded: true }), server);

    fireEvent.change(await slot.findByRole("textbox", { name: "New quest" }), {
      target: { value: "Follow up" },
    });
    fireEvent.click(button(slot, "Add"));
    fireEvent.click(button(slot, "Open the Quests tab"));

    await waitFor(() =>
      expect(server.mutations).toEqual([{ type: "add", descriptions: ["Follow up"] }]),
    );
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "quests" } },
    ]);
  });
});

describe("quests Info row", () => {
  async function renderRow(view: QuestView) {
    const app = await loadApp();
    const [row] = app.threadInfoRows;
    if (!row) throw new Error("the Info row is not registered");
    const props: ExperimentalThreadInfoProps = {
      threadId: "t1",
      projectId: "p1",
      environment: null,
    };
    const slot = render(row.component, props, backend(view));
    await waitFor(() => expect(getLogCalls(slot)).toBe(1));
    return slot;
  }

  it("shows nothing for a thread without quests", async () => {
    const slot = await renderRow(EMPTY);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(slot.container.textContent).toBe("");
  });

  it("shows progress and the next item, opening the Quests tab", async () => {
    const slot = await renderRow(LOG);

    fireEvent.click(
      await slot.findByRole("button", {
        name: "Open the Quests tab: 1 of 3 done, next: Child",
      }),
    );

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "quests" } },
    ]);
  });
});

describe("Add as a quest", () => {
  async function composerParts() {
    const app = await loadApp();
    const [customization] = app.composerCustomizations;
    const item = customization?.sendMenu?.[0] as ComposerSendMenuItem;
    const popup = customization?.experimental_popups?.[0] as ExperimentalComposerPopupRegistration;
    return { item, popup };
  }

  it("is offered only for a draft, and opens its popup", async () => {
    const { item } = await composerParts();
    const openPopup = vi.fn(() => true);
    const composer = {
      isEmpty: false,
      experimental_openPopup: openPopup,
    } as unknown as PluginComposerApi;

    expect(
      typeof item.disabled === "function" && item.disabled({ isEmpty: true } as PluginComposerApi),
    ).toBe(true);
    expect(typeof item.disabled === "function" && item.disabled(composer)).toBe(false);
    await item.run({ composer });
    expect(openPopup).toHaveBeenCalledWith("add-as-quest");
  });

  it("adds the draft as a quest and clears the composer", async () => {
    const { popup } = await composerParts();
    const server = backend(EMPTY);
    const slot = render(popup.component, {}, server, {
      composer: { text: "  Also update the README  ", scope: { kind: "thread", threadId: "t1" } },
    });

    const input = (await slot.findByRole("textbox", {
      name: "Quest from your draft",
    })) as HTMLInputElement;
    expect(input.value).toBe("Also update the README");
    fireEvent.click(button(slot, "Add quest"));

    await waitFor(() =>
      expect(server.mutations).toEqual([{ type: "add", descriptions: ["Also update the README"] }]),
    );
    await waitFor(() => expect(slot.inspection.composer.text).toBe(""));
  });
});

describe("the quiet clock", () => {
  it("forgets a turn's start once no view shows the thread", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: 60 * 60_000 });
    const view = viewOf([parent, child], { agentChangedAt: 0 });
    const first = await renderTab(backend(view), { sidebarThreads: threadsState("active") });
    await first.findByText(/The agent last changed the log/);
    await act(async () => {
      vi.advanceTimersByTime(11 * 60_000);
    });
    expect(await first.findByText(/and is still working/)).toBeTruthy();
    first.lifecycle.unmount();
    slots.splice(slots.indexOf(first), 1);

    vi.setSystemTime(2 * 60 * 60_000);
    const second = await renderTab(backend(view), { sidebarThreads: threadsState("active") });

    expect(await second.findByText(/The agent last changed the log 2 h ago\./)).toBeTruthy();
    expect(second.queryByText(/and is still working/)).toBeNull();
  });
});

describe("Add as a quest with attachments", () => {
  it("says the attachments stay in the composer", async () => {
    const app = await loadApp();
    const popup = app.composerCustomizations[0]
      ?.experimental_popups?.[0] as ExperimentalComposerPopupRegistration;
    const slot = render(popup.component, {}, backend(EMPTY), {
      composer: { text: "Ship it", attachmentCount: 1, scope: { kind: "thread", threadId: "t1" } },
    });

    expect(await slot.findByText(/your attachments stay in the composer/)).toBeTruthy();
  });
});
