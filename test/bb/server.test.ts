import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin, { QUEST_SKILL_POINTER } from "../../extensions/bb/server.js";
import { USER_CHANGES_PREFIX } from "../../extensions/bb/store.js";
import { QUEST_PROMPT_REMINDER } from "../../src/prompts.js";
import { QUEST_ACTION_VALUES } from "../../src/quest/types.js";

type ThreadResponse = ReturnType<typeof makeThreadResponse>;

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

async function loadPlugin(threads: ThreadResponse[] = []) {
  const namespaces = new Map<string, Record<string, unknown>>();
  const key = (pluginId: string | undefined, threadId: string) =>
    `${pluginId ?? "pi-quests"}/${threadId}`;
  const { bb, harness } = createFakePluginHost({
    pluginId: "pi-quests",
    sdk: {
      threads: {
        getPluginMetadata: async ({ threadId, pluginId }) =>
          structuredClone(namespaces.get(key(pluginId, threadId)) ?? {}),
        updatePluginMetadata: async ({ threadId, pluginId, set = {} }) => {
          const next = { ...namespaces.get(key(pluginId, threadId)), ...structuredClone(set) };
          namespaces.set(key(pluginId, threadId), next);
          return structuredClone(next);
        },
        get: async ({ threadId }) =>
          threads.find((thread) => thread.id === threadId) ?? makeThreadResponse({ id: threadId }),
      },
    },
  });
  await plugin(bb);
  return {
    harness,
    tool: (threadId: string, input: unknown) =>
      harness.behavior.callAgentTool("quest", input, { threadId }),
    rpc: (method: string, input: unknown) => harness.behavior.callRpc(method, input),
    saved: (threadId: string) => namespaces.get(key("quests", threadId)),
    seed: (threadId: string, value: Record<string, unknown>) =>
      namespaces.set(key("quests", threadId), value),
    updates: () => harness.inspection.sdk.callsTo("threads.updatePluginMetadata"),
  };
}

let host: Awaited<ReturnType<typeof loadPlugin>> | undefined;
afterEach(async () => {
  await host?.harness.lifecycle.dispose();
  host = undefined;
});

describe("quests bb plugin registration", () => {
  it("registers one quest tool, the two RPC methods and no configure callback", async () => {
    host = await loadPlugin();
    const { registrations } = host.harness.inspection;

    expect(registrations.agentTools.map((tool) => tool.name)).toEqual(["quest"]);
    expect(registrations.agentConfigurationProvider).toBeNull();
    expect([...registrations.rpcMethods].sort()).toEqual(["getLog", "mutate"]);
    expect(registrations.threadEventHandlers["thread.created"]).toBe(1);
  });

  it("instructs agents with the quest gate and reminders in under 4096 characters", async () => {
    host = await loadPlugin();
    const [tool] = host.harness.inspection.registrations.agentTools;

    expect(tool?.instructions).toContain("ALWAYS ensure the current work is tracked");
    for (const reminder of QUEST_PROMPT_REMINDER) expect(tool?.instructions).toContain(reminder);
    expect(tool?.instructions?.length).toBeLessThan(4096);
  });

  it("advertises the same actions and id pattern as the pi tool", async () => {
    host = await loadPlugin();
    const [tool] = host.harness.inspection.registrations.agentTools;
    const schema = tool?.inputSchema as {
      properties: Record<
        string,
        { enum?: string[]; pattern?: string; items?: { pattern: string } }
      >;
    };

    expect(schema.properties.action?.enum).toEqual([...QUEST_ACTION_VALUES]);
    for (const field of ["id", "targetId", "parentId"]) {
      expect(schema.properties[field]?.pattern).toBe("^[0-9a-f]{2}$");
    }
    expect(schema.properties.ids?.items?.pattern).toBe("^[0-9a-f]{2}$");
  });
});

describe("quests bb plugin tool and panel", () => {
  it.each(QUEST_ACTION_VALUES)("accepts the %s action", async (action) => {
    host = await loadPlugin();

    await expect(host.tool("t1", { action })).resolves.toBeDefined();
  });

  it.each([
    ["an unknown action", { action: "explode" }],
    ["a malformed id", { action: "toggle", id: "XYZ" }],
    ["an empty ids list", { action: "delete", ids: [] }],
    ["a non-string description", { action: "update", id: "01", description: 5 }],
  ])("rejects %s before running it", async (_case, input) => {
    host = await loadPlugin();

    await expect(host.tool("t1", input)).rejects.toThrow();
    expect(host.updates()).toHaveLength(0);
  });

  it("maps every tool action onto the engine", async () => {
    host = await loadPlugin();
    const run = (input: Record<string, unknown>) => host?.tool("t1", input);
    const listed = async () =>
      (
        (await host?.rpc("getLog", { threadId: "t1" })) as {
          quests: { description: string; done: boolean }[];
        }
      ).quests.map((quest) => `${quest.description}${quest.done ? " (done)" : ""}`);

    const results = [
      await run({ action: "add", descriptions: ["A", "B", "C"] }),
      await run({ action: "split", id: "01", descriptions: ["A1"] }),
      await run({ action: "add_step", id: "01", descriptions: ["A2"] }),
      await run({ action: "reorder", id: "02", targetId: "01" }),
      await run({ action: "update", id: "02", description: "B2" }),
      await run({ action: "reparent", id: "02", parentId: "01" }),
      await run({ action: "delete", ids: ["03"] }),
      await run({ action: "toggle", ids: ["04", "05", "02"] }),
      await run({ action: "toggle", id: "01" }),
    ];
    expect(await listed()).toEqual(["A (done)", "A1 (done)", "A2 (done)", "B2 (done)"]);

    results.push(await run({ action: "clear" }));
    expect(await listed()).toEqual([]);
    results.push(await run({ action: "undo" }));
    expect(await listed()).toHaveLength(4);
    results.push(await run({ action: "redo" }), await run({ action: "undo" }));
    results.push(await run({ action: "clear", all: true }));
    expect(await listed()).toEqual([]);
    expect(results.filter((result) => typeof result !== "string")).toEqual([]);
  });

  it("shares one log between the tool and the panel", async () => {
    host = await loadPlugin();

    expect(await host.tool("t1", { action: "add", descriptions: ["From the agent"] })).toBe(
      "Added quest [01]: From the agent",
    );
    expect(await host.rpc("getLog", { threadId: "t1" })).toEqual({
      quests: [
        { id: "01", description: "From the agent", done: false, createdAt: expect.any(Number) },
      ],
      progress: { done: 0, total: 1, current: "From the agent" },
    });

    const change = await host.rpc("mutate", {
      threadId: "t1",
      action: { type: "toggle", id: "01" },
    });
    expect(change).toEqual({
      message: "Quest [01] done",
      view: expect.objectContaining({ progress: { done: 1, total: 1, current: null } }),
    });
  });

  it("tells the agent about a panel change in the next tool result only", async () => {
    host = await loadPlugin();
    await host.rpc("mutate", {
      threadId: "t1",
      action: { type: "add", descriptions: ["From the panel"] },
    });

    const first = await host.tool("t1", { action: "list" });
    const second = await host.tool("t1", { action: "list" });

    expect(first).toBe(`${USER_CHANGES_PREFIX}\n- Added quest [01]: From the panel\n\n${second}`);
    expect(second).not.toContain(USER_CHANGES_PREFIX);
  });

  it("returns a failed action as a tool error without saving it", async () => {
    host = await loadPlugin();

    expect(await host.tool("t1", { action: "toggle", id: "ff" })).toEqual({
      content: [{ type: "text", text: expect.stringContaining("Quest [ff] not found") }],
      isError: true,
    });
    expect(host.updates()).toHaveLength(0);
  });

  it("rejects a failed panel change", async () => {
    host = await loadPlugin();

    await expect(
      host.rpc("mutate", { threadId: "t1", action: { type: "toggle", id: "ff" } }),
    ).rejects.toThrow("Quest [ff] not found");
  });

  it.each([
    ["a read-only action", { threadId: "t1", action: { type: "list" } }],
    ["a malformed id", { threadId: "t1", action: { type: "toggle", id: "nothex" } }],
    ["an unknown field", { threadId: "t1", action: { type: "undo", id: "01" } }],
    ["a missing thread", { action: { type: "undo" } }],
  ])("rejects a panel change with %s", async (_case, input) => {
    host = await loadPlugin();

    await expect(host.rpc("mutate", input)).rejects.toThrow();
  });

  it("reports invalid saved quests as a tool error", async () => {
    host = await loadPlugin();
    host.seed("t1", { log: { version: 7 } });

    expect(await host.tool("t1", { action: "list" })).toEqual({
      content: [
        { type: "text", text: expect.stringMatching(/saved quests for thread t1 are invalid/i) },
      ],
      isError: true,
    });
  });

  it("saves under the quests namespace and signals the thread", async () => {
    host = await loadPlugin();

    await host.tool("t9", { action: "add", descriptions: ["Tracked"] });

    expect(host.updates().map(([args]) => (args as { pluginId: string }).pluginId)).toEqual([
      "quests",
    ]);
    expect(host.saved("t9")?.progress).toEqual({ done: 0, total: 1, current: "Tracked" });
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "quests", payload: { threadId: "t9" } },
    ]);
  });

  it("answers skill and rules with a pointer to the quest-management skill", async () => {
    host = await loadPlugin();

    expect(QUEST_SKILL_POINTER).toContain("quest-management");
    expect(await host.tool("t1", { action: "skill" })).toBe(QUEST_SKILL_POINTER);
    expect(await host.tool("t1", { action: "rules" })).toBe(QUEST_SKILL_POINTER);
  });
});

describe("quests bb plugin forks", () => {
  it("copies the source's quests into a fork when bb announces it", async () => {
    host = await loadPlugin([forkThread]);
    await host.tool("source", { action: "add", descriptions: ["Shared"] });

    const { errors } = await host.harness.behavior.emitThreadEvent("thread.created", {
      thread: forkThread,
    });

    expect(errors).toEqual([]);
    expect(host.saved("fork")?.log).toEqual(host.saved("source")?.log);
    await host.tool("fork", { action: "add", descriptions: ["Fork only"] });
    expect(
      ((await host.rpc("getLog", { threadId: "source" })) as { quests: unknown[] }).quests,
    ).toHaveLength(1);
  });

  it("leaves a side chat without copied quests", async () => {
    host = await loadPlugin([sideChatThread]);
    await host.tool("source", { action: "add", descriptions: ["Main thread"] });

    await host.harness.behavior.emitThreadEvent("thread.created", { thread: sideChatThread });

    expect(host.saved("side")).toBeUndefined();
    expect(await host.rpc("getLog", { threadId: "side" })).toEqual({
      quests: [],
      progress: { done: 0, total: 0, current: null },
    });
  });

  it("logs a fork copy that fails instead of throwing from the event", async () => {
    host = await loadPlugin([forkThread]);
    host.harness.inspection.sdk.stub("threads.getPluginMetadata", async () => {
      throw new Error("metadata unavailable");
    });

    const { errors } = await host.harness.behavior.emitThreadEvent("thread.created", {
      thread: forkThread,
    });

    expect(errors).toEqual([]);
    expect(host.harness.inspection.logEntries).toContainEqual({
      level: "warn",
      message: expect.stringContaining("metadata unavailable"),
    });
  });
});
