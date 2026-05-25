import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

describe("extension entry point", () => {
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
    const { default: init } = await import("../src/index.js");
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
    expect(result.systemPrompt).toContain("Quest Management");
    expect(result.systemPrompt).toContain("Use the learn_quests tool");
  });

  it("suppresses Quest Management on resume when reconstructed quests exist (seed path)", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../src/index.js");
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
    // Seed path fired during reconstruction (questLog.getAll().length > 0),
    // so before_agent_start injects the Quest Management section.
    const result = await pi._handlers.before_agent_start[0]({ systemPrompt: "base" });
    expect(result.systemPrompt).toContain("Quest Management");
    expect(result.systemPrompt).toContain("Use the learn_quests tool");
  });

  it("shows an alternate prompt after first quest tool use", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../src/index.js");
    init(pi as unknown as ExtensionAPI);
    // Before first quest tool use, suffix is injected.
    const before = await pi._handlers.before_agent_start[0]({ systemPrompt: "base" });
    expect(before.systemPrompt).toContain("Use quests to track this task");
    // After first quest tool execution.
    await pi._handlers.tool_execution_end[0](
      { toolName: "quest" },
      {
        ui: {
          setStatus: vi.fn(),
          theme: { fg: vi.fn((_, t) => t), bold: vi.fn((t) => t), strikethrough: vi.fn((t) => t) },
        },
      },
    );
    const after = await pi._handlers.before_agent_start[0]({ systemPrompt: "base" });
    expect(after.systemPrompt).toContain("Use quests to track this task");
  });

  it("does not register a context handler for dynamic reminders", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../src/index.js");
    init(pi as unknown as ExtensionAPI);

    expect(pi._handlers.context).toBeUndefined();
  });

  it("registers shortcut during extension init", async () => {
    const pi = createMockPi();
    const { default: init } = await import("../src/index.js");
    init(pi as unknown as ExtensionAPI);
    expect(pi.registerShortcut).toHaveBeenCalledWith(
      "ctrl+shift+l",
      expect.objectContaining({ description: "Open quest list" }),
    );
  });

  it("does not set status when display.showStatus=false even if quests exist", async () => {
    const pi = createMockPi();
    const setStatus = vi.fn();
    const { default: init } = await import("../src/index.js");
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
    const { default: init } = await import("../src/index.js");
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

  it("updates status after quest tool execution", async () => {
    const pi = createMockPi();
    const setStatus = vi.fn();
    const { default: init } = await import("../src/index.js");
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
