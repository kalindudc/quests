import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEST_PROMPT_GATE } from "../../src/prompts.js";

describe("extension entry point", () => {
  beforeEach(() => {
    // Shells inside a bb pi thread inherit bb's tools file; these tests expect plain pi.
    vi.stubEnv("PI_BB_TOOLS_FILE", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createMockPi() {
    const handlers: Record<string, Function[]> = {};
    return {
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(handler);
      }),
      registerTool: vi.fn(),
      registerMessageRenderer: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      _handlers: handlers,
    };
  }

  it("injects Quest Management section into system prompt", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);
    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: {
            quests: [{ id: "01", description: "Test task", done: false, createdAt: 1 }],
          },
        },
      },
    ];
    await pi._handlers.session_start[0](
      {},
      {
        cwd: "/tmp",
        sessionManager: { getBranch: vi.fn().mockReturnValue(branch) },
        ui: {
          setStatus: vi.fn(),
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );
    const handler = pi._handlers.before_agent_start[0];
    const result = await handler({ systemPrompt: "base" });
    expect(result.systemPrompt).toBe(`# Quest Management\n${QUEST_PROMPT_GATE}\n\nbase`);
    expect(result.systemPrompt).not.toContain("learn_quests");
  });

  it("omits the no-quests reminder on resume when reconstructed quests exist", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);
    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: {
            quests: [{ id: "01", description: "Test task", done: false, createdAt: 1 }],
          },
        },
      },
    ];
    await pi._handlers.session_start[0](
      {},
      {
        cwd: "/tmp",
        sessionManager: { getBranch: vi.fn().mockReturnValue(branch) },
        ui: {
          setStatus: vi.fn(),
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );
    const result = await pi._handlers.before_agent_start[0]({ systemPrompt: "base" });
    expect(result.systemPrompt).toContain(QUEST_PROMPT_GATE);
    expect(result.systemPrompt).not.toContain("learn_quests");
  });

  it("shows the no-quests gate only for an empty log", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);
    await pi._handlers.session_start[0](
      {},
      {
        cwd: "/tmp",
        sessionManager: { getBranch: vi.fn().mockReturnValue([]) },
        ui: {
          setStatus: vi.fn(),
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );

    const empty = await pi._handlers.before_agent_start[0]({ systemPrompt: "base" });
    expect(empty.systemPrompt).toMatch(
      /^# Quest Management\n[\s\S]*\n\nbase\n\n## Quest Management\n/,
    );
    expect(empty.systemPrompt).toContain(QUEST_PROMPT_GATE);
    expect(empty.systemPrompt).toContain("Use the learn_quests tool");

    const questTool = pi.registerTool.mock.calls
      .map(([tool]) => tool)
      .find((tool) => tool.name === "quest");
    await questTool.execute("tc1", { action: "add", descriptions: ["Track me"] });
    const tracked = await pi._handlers.before_agent_start[0]({ systemPrompt: "base" });
    expect(tracked.systemPrompt).toBe(`# Quest Management\n${QUEST_PROMPT_GATE}\n\nbase`);
  });

  it("does not register a context handler for dynamic reminders", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);

    expect(pi._handlers.context).toBeUndefined();
  });

  it("registers shortcut during extension init", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);
    expect(pi.registerShortcut).toHaveBeenCalledWith(
      "ctrl+shift+l",
      expect.objectContaining({ description: "Open quest list" }),
    );
  });

  it("does not set status when display.showStatus=false even if quests exist", async () => {
    const pi = createMockPi();
    const setStatus = vi.fn();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);
    const cwd = mkdtempSync(join(tmpdir(), "pi-quests-test-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ "pi-quests": { display: { showStatus: false } } }),
    );
    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: {
            quests: [{ id: "01", description: "Test task", done: false, createdAt: 1 }],
          },
        },
      },
    ];
    await pi._handlers.session_start[0](
      {},
      {
        cwd,
        sessionManager: { getBranch: vi.fn().mockReturnValue(branch) },
        ui: {
          setStatus,
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("sets status on session_start when quests exist", async () => {
    const pi = createMockPi();
    const setStatus = vi.fn();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);
    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: {
            quests: [
              { id: "01", description: "A", done: true, createdAt: 1 },
              { id: "02", description: "B", done: false, createdAt: 2 },
            ],
          },
        },
      },
    ];
    await pi._handlers.session_start[0](
      {},
      {
        cwd: "/tmp",
        sessionManager: { getBranch: vi.fn().mockReturnValue(branch) },
        ui: {
          setStatus,
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );
    expect(setStatus).toHaveBeenCalledWith("pi-quests", expect.stringContaining("1/2"));
  });

  describe("inside bb", () => {
    function writeToolsFile(contents: string): string {
      const path = join(mkdtempSync(join(tmpdir(), "pi-quests-bb-")), "pi-tools.json");
      writeFileSync(path, contents);
      return path;
    }

    it("steps aside when bb already supplies a quest tool", async () => {
      vi.stubEnv(
        "PI_BB_TOOLS_FILE",
        writeToolsFile(JSON.stringify([{ name: "AskUserQuestion" }, { name: "quest" }])),
      );
      const pi = createMockPi();
      const { default: init } = await import("../../extensions/pi/index.js");
      init(pi as unknown as ExtensionAPI);

      expect(pi.registerShortcut).not.toHaveBeenCalled();
      expect(pi.on).not.toHaveBeenCalled();
      expect(pi.registerTool).not.toHaveBeenCalled();
      expect(pi.registerCommand).not.toHaveBeenCalled();
      expect(pi.registerMessageRenderer).not.toHaveBeenCalled();
    });

    it.each([
      ["lists no quest tool", JSON.stringify([{ name: "AskUserQuestion" }])],
      ["is malformed", "{not json"],
    ])("keeps plain pi behavior when the bb tools file %s", async (_case, contents) => {
      vi.stubEnv("PI_BB_TOOLS_FILE", writeToolsFile(contents));
      const pi = createMockPi();
      const { default: init } = await import("../../extensions/pi/index.js");
      init(pi as unknown as ExtensionAPI);

      expect(pi.registerShortcut).toHaveBeenCalledTimes(1);
      expect(pi.registerMessageRenderer).toHaveBeenCalledWith("quest-changelog", expect.anything());
      expect(Object.keys(pi._handlers)).toEqual([
        "session_start",
        "session_tree",
        "tool_execution_end",
        "before_agent_start",
      ]);
    });
  });

  describe("a session saved by pi-quests 0.3 or earlier", () => {
    // Those versions saved numeric quest ids, which the engine cannot restore.
    const legacyBranch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: {
            quests: [{ id: 1, description: "Old quest", done: false, createdAt: 1 }],
            nextId: 2,
          },
        },
      },
    ];
    const currentBranch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "quest",
          details: {
            quests: [{ id: "01", description: "Current quest", done: false, createdAt: 1 }],
          },
        },
      },
    ];
    const ui = {
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
    };
    const contextFor = (branch: unknown[]) => ({
      cwd: "/tmp",
      hasUI: true,
      sessionManager: { getBranch: vi.fn().mockReturnValue(branch) },
      ui,
    });

    beforeEach(() => {
      ui.notify.mockClear();
      ui.setStatus.mockClear();
    });

    async function startSession(branch: unknown[]) {
      const pi = createMockPi();
      const { default: init } = await import("../../extensions/pi/index.js");
      init(pi as unknown as ExtensionAPI);
      await pi._handlers.session_start[0]({}, contextFor(branch));
      return pi;
    }

    async function systemPrompt(pi: ReturnType<typeof createMockPi>): Promise<string> {
      return (await pi._handlers.before_agent_start[0]({ systemPrompt: "base" })).systemPrompt;
    }

    it("starts empty, says so once and still registers the quest tool and /quests", async () => {
      const pi = await startSession(legacyBranch);

      expect(pi.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
        "quest",
        "learn_quests",
      ]);
      expect(pi.registerCommand).toHaveBeenCalledWith("quests", expect.anything());
      expect(ui.notify).toHaveBeenCalledTimes(1);
      expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("older pi-quests"), "warning");
      expect(await systemPrompt(pi)).toContain("No active quests");

      const quest = pi.registerTool.mock.calls
        .map(([tool]) => tool)
        .find((tool) => tool.name === "quest");
      const added = await quest.execute("tc1", { action: "add", descriptions: ["New quest"] });
      expect(added.content[0].text).toMatch(/^Added quest \[[0-9a-f]{2}\]: New quest$/);
    });

    it("empties the log when the tree moves onto an old branch, notifying once", async () => {
      const pi = await startSession(currentBranch);
      expect(await systemPrompt(pi)).not.toContain("No active quests");

      await pi._handlers.session_tree[0]({}, contextFor(legacyBranch));
      await pi._handlers.session_tree[0]({}, contextFor(legacyBranch));

      expect(ui.notify).toHaveBeenCalledTimes(1);
      expect(ui.setStatus).toHaveBeenLastCalledWith("pi-quests", undefined);
      expect(await systemPrompt(pi)).toContain("No active quests");
    });

    it("still reports failures other than unreadable saved quests", async () => {
      const pi = createMockPi();
      const { default: init } = await import("../../extensions/pi/index.js");
      init(pi as unknown as ExtensionAPI);
      const ctx = contextFor([]);
      ctx.sessionManager.getBranch.mockImplementation(() => {
        throw new Error("branch unavailable");
      });

      await expect(pi._handlers.session_start[0]({}, ctx)).rejects.toThrow("branch unavailable");
    });
  });

  it("updates status after quest tool execution", async () => {
    const pi = createMockPi();
    const setStatus = vi.fn();
    const { default: init } = await import("../../extensions/pi/index.js");
    init(pi as unknown as ExtensionAPI);
    await pi._handlers.session_start[0](
      {},
      {
        cwd: "/tmp",
        sessionManager: { getBranch: vi.fn().mockReturnValue([]) },
        ui: {
          setStatus,
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );
    expect(setStatus).toHaveBeenLastCalledWith("pi-quests", undefined);
    await pi._handlers.tool_execution_end[0](
      { toolName: "quest" },
      {
        ui: {
          setStatus,
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );
  });
});
