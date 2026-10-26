import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentOnly, isUserRequest, refuseNoteStartingTurn } from "../../extensions/bb/requests.js";
import plugin from "../../extensions/bb/server.js";

type ThreadResponse = ReturnType<typeof makeThreadResponse>;
type Row = { seq: number; createdAt: number; type: string; data: unknown };

let randomCall = 0;
beforeEach(() => {
  randomCall = 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    randomCall++;
    return randomCall / 256;
  });
  vi.useFakeTimers({ toFake: ["Date"], now: 1_000 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const request = (seq: number, createdAt: number, text = "do it", visibility?: string): Row => ({
  seq,
  createdAt,
  type: "client/turn/requested",
  data: { initiator: "user", input: [{ type: "text", text, mentions: [], visibility }] },
});
const item =
  (kind: "started" | "completed") =>
  (seq: number, type: string, id: string, tool?: string): Row => ({
    seq,
    createdAt: 0,
    type: `item/${kind}`,
    data: { item: { type, id, tool } },
  });
const started = item("started");
const completed = item("completed");

async function loadPlugin(thread: Partial<ThreadResponse> = {}) {
  const namespaces = new Map<string, Record<string, unknown>>();
  const events: Row[] = [];
  const sends: unknown[] = [];
  let current = makeThreadResponse({ id: "t1", providerId: "pi", status: "active", ...thread });
  const { bb, harness } = createFakePluginHost({
    pluginId: "pi-quests",
    sdk: {
      threads: {
        getPluginMetadata: async ({ threadId }) => structuredClone(namespaces.get(threadId) ?? {}),
        updatePluginMetadata: async ({ threadId, set = {} }) => {
          const next = { ...namespaces.get(threadId), ...structuredClone(set) };
          namespaces.set(threadId, next);
          return structuredClone(next);
        },
        get: async () => current,
        send: async (args) => {
          sends.push(args);
          return { ok: true, delivery: "sent" };
        },
        events: {
          list: async ({ types, afterSeq, order, limit }) => {
            // bb's own limit, which the plugin must respect.
            if (Number(limit) > 100)
              throw new Error("HTTP 400: Thread event limit cannot exceed 100");
            const after = afterSeq === undefined ? -1 : Number(afterSeq);
            const rows = events.filter(
              (row) => types?.includes(row.type as never) && row.seq > after,
            );
            return (order === "desc" ? rows.reverse() : rows) as never;
          },
        },
      },
    },
  });
  await plugin(bb);
  const tool = (input: unknown) =>
    harness.behavior.callAgentTool("quest", input, { threadId: "t1" });
  return {
    harness,
    events,
    sends,
    tool,
    rpc: (method: string, input: unknown) => harness.behavior.callRpc(method, input),
    setThread: (next: Partial<ThreadResponse>) => {
      current = { ...current, ...next };
    },
    turn: async () => {
      await harness.behavior.emitThreadEvent("thread.active", { thread: current });
      return harness.behavior.emitThreadEvent("experimental_thread.events", {
        thread: current,
        sequence: events.at(-1)?.seq ?? 0,
      });
    },
  };
}

let host: Awaited<ReturnType<typeof loadPlugin>> | undefined;
afterEach(async () => {
  await host?.harness.lifecycle.dispose();
  host = undefined;
});

/** Quests added during a first request, then a second request that leaves them alone. */
async function staleThread(thread: Partial<ThreadResponse> = {}) {
  const loaded = await loadPlugin(thread);
  loaded.events.push(request(1, 500));
  await loaded.tool({ action: "add", descriptions: ["Build it"] });
  loaded.events.push(request(2, 2_000), request(3, 3_000), started(4, "commandExecution", "i4"));
  return loaded;
}

describe("isUserRequest", () => {
  it("counts a person's request and not an agent-only note or a system message", () => {
    expect(isUserRequest(request(1, 0))).toBe(true);
    expect(isUserRequest(request(1, 0, "note", "agent-only"))).toBe(false);
    expect(isUserRequest({ seq: 1, createdAt: 0, data: { initiator: "system", input: [] } })).toBe(
      false,
    );
  });
});

describe("the quest note on a new request", () => {
  const signal = (loaded: Awaited<ReturnType<typeof loadPlugin>>) =>
    loaded.harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread: makeThreadResponse({ id: "t1", providerId: "pi", status: "active" }),
      sequence: loaded.events.at(-1)?.seq ?? 0,
    });

  it("steers one agent-only note into the turn while a tool runs", async () => {
    host = await staleThread();

    await host.turn();

    expect(host.sends).toEqual([
      {
        threadId: "t1",
        mode: "steer",
        input: agentOnly(expect.stringContaining("[Quests] 0 of 1 done. Next: [01] Build it")),
      },
    ]);
    await host.turn();
    expect(host.sends).toHaveLength(1);
  });

  it("waits while the agent has only thought, replied or used tools that already finished", async () => {
    host = await staleThread();
    host.events.splice(
      -1,
      1,
      started(4, "reasoning", "i4"),
      started(5, "agentMessage", "i5"),
      started(6, "commandExecution", "i6"),
      completed(7, "commandExecution", "i6"),
    );

    await host.turn();
    expect(host.sends).toEqual([]);

    host.events.push(started(8, "fileRead", "i8"));
    await signal(host);
    expect(host.sends).toHaveLength(1);
  });

  it("sends nothing once the agent calls the quest tool", async () => {
    host = await staleThread();
    host.events.push(started(5, "toolCall", "i5", "mcp__bb-bridge__quest"));

    await host.turn();

    expect(host.sends).toEqual([]);
  });

  it("drops the watch when the turn ends before a tool runs", async () => {
    host = await staleThread();
    host.events.pop();
    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "t1", providerId: "pi", status: "active" }),
    });
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "t1" }),
      lastAssistantText: null,
    });
    host.events.push(started(9, "commandExecution", "i9"));

    await signal(host);

    expect(host.sends).toEqual([]);
  });

  it("never installs a watch for a turn that ended while its request was being read", async () => {
    host = await staleThread();
    host.events.pop();
    const active = host.harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "t1", providerId: "pi", status: "active" }),
    });
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "t1" }),
      lastAssistantText: null,
    });
    await active;
    host.events.push(started(9, "commandExecution", "i9"));

    await signal(host);

    expect(host.sends).toEqual([]);
  });

  it("skips providers whose steer would cancel the turn", async () => {
    host = await staleThread({ providerId: "acp-cursor" });

    await host.turn();

    expect(host.sends).toEqual([]);
  });

  it("ignores a turn started by an agent-only message", async () => {
    host = await staleThread();
    host.events.splice(-1, 0, request(5, 4_000, "memory checkpoint", "agent-only"));

    await host.turn();

    expect(host.sends).toEqual([]);
  });

  it("sends nothing to a thread that went idle before the note", async () => {
    host = await staleThread();
    host.setThread({ status: "idle" });

    await host.turn();

    expect(host.sends).toEqual([]);
  });
});

describe("the dispatch checkpoint", () => {
  const note = agentOnly("[Quests] 0 of 1 done. Next: [01] Build it");

  it("is registered", async () => {
    host = await loadPlugin();

    expect(host.harness.inspection.registrations.hooks["message.dispatch"]).toBe(
      refuseNoteStartingTurn,
    );
  });

  it("refuses a quest note that would start a turn and lets every other message through", () => {
    type Blocks = Parameters<typeof refuseNoteStartingTurn>[0]["input"]["blocks"];
    const decide = (attempt: "start-turn" | "join-turn", blocks: Blocks = note) =>
      refuseNoteStartingTurn(
        makeMessageDispatchHookContext({ attempt, input: { blocks, text: "" } }),
      ).action;

    expect(decide("start-turn")).toBe("reject");
    expect(decide("join-turn")).toBe("proceed");
    expect(
      decide("start-turn", [{ type: "text", text: "[Quests] typed by a person", mentions: [] }]),
    ).toBe("proceed");
    expect(decide("start-turn", agentOnly("Stored cortex text"))).toBe("proceed");
  });
});

describe("Tell it now", () => {
  it("steers the panel's unseen changes into a running turn", async () => {
    host = await loadPlugin();
    await host.rpc("mutate", { threadId: "t1", action: { type: "add", descriptions: ["Docs"] } });

    expect(await host.rpc("tell", { threadId: "t1" })).toEqual({ sent: true });
    expect(host.sends).toEqual([
      {
        threadId: "t1",
        mode: "steer",
        input: agentOnly(expect.stringContaining("- Added quest [01]: Docs")),
      },
    ]);
    expect(await host.rpc("getLog", { threadId: "t1" })).toMatchObject({ unseenChanges: 0 });
  });

  it("sends nothing to an idle thread", async () => {
    host = await loadPlugin({ status: "idle" });
    await host.rpc("mutate", { threadId: "t1", action: { type: "add", descriptions: ["Docs"] } });

    expect(await host.rpc("tell", { threadId: "t1" })).toEqual({ sent: false });
    expect(await host.rpc("getLog", { threadId: "t1" })).toMatchObject({ unseenChanges: 1 });
  });
});
