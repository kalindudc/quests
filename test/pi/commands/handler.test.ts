import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQuestsHandler } from "../../../extensions/pi/commands/handler.js";
import { DEFAULT_CONFIG } from "../../../extensions/pi/config.js";
import { getVersion } from "../../../extensions/pi/version.js";
import { QuestLog } from "../../../src/quest/dataplane.js";

vi.mock("../../../extensions/pi/logger.js", () => ({ logger: { debug: vi.fn() } }));

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

describe("createQuestsHandler", () => {
  function createMockPi() {
    return {
      sendMessage: vi.fn(),
    } as unknown as Parameters<typeof createQuestsHandler>[0];
  }

  function createMockCtx() {
    return {
      ui: {
        notify: vi.fn(),
        custom: vi.fn().mockResolvedValue(undefined),
      },
      hasUI: true,
    } as unknown as Parameters<ReturnType<typeof createQuestsHandler>>[1];
  }

  function createHandler() {
    return createQuestsHandler(createMockPi(), new QuestLog(), DEFAULT_CONFIG);
  }

  it("shows version for 'version' subcommand", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("version", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(`pi-quests v${getVersion()}`, "info");
  });

  it("sends a quest-changelog message for 'changelog' subcommand", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx();
    const handler = createQuestsHandler(pi, new QuestLog(), DEFAULT_CONFIG);
    await handler("changelog", ctx);
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "quest-changelog",
        display: true,
        details: expect.objectContaining({
          content: expect.stringContaining("pi-quests Changelog"),
        }),
      }),
    );
  });

  it("shows usage for unknown subcommand", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("unknown", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Unknown subcommand: unknown. Use /quests help to see available commands.",
      "error",
    );
  });

  it("lists quests when called with no args", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("", ctx);
    expect(ctx.ui.custom).toHaveBeenCalled();
  });

  it("adds a quest", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Test quest", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Added quest [01]: Test quest", "info");
  });

  it("lists quests with custom UI", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add A", ctx);
    await handler("list", ctx);
    expect(ctx.ui.custom).toHaveBeenCalled();
  });

  it("shows error for list without UI", async () => {
    const ctx = createMockCtx();
    ctx.hasUI = false;
    const handler = createHandler();
    await handler("list", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Interactive mode required", "error");
  });

  it("toggles a quest", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Toggle me", ctx);
    await handler("toggle 01", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Quest [01] done", "info");
    await handler("toggle 01", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Quest [01] undone", "info");
  });

  it("toggles multiple tasks in one command", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Parent", ctx);
    await handler("add-step 01 Sub", ctx);
    await handler("toggle 01 02", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Toggled 2 tasks:\n[01] done\n[02] done", "info");
  });

  it("shows error when toggling nonexistent quest", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("toggle ff", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Quest [ff] not found"),
      "error",
    );
  });

  it("updates a quest", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Old desc", ctx);
    await handler("update 01 New desc", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Updated quest [01]: New desc", "info");
  });

  it("shows error when updating nonexistent quest", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("update ff Missing", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Quest [ff] not found"),
      "error",
    );
  });

  it("deletes a quest", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Delete me", ctx);
    await handler("delete 01", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Deleted quest [01]: Delete me", "info");
  });

  it("deletes multiple tasks in one command when all incomplete child steps are selected", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Parent", ctx);
    await handler("add-step 01 Sub", ctx);
    await handler("add Another", ctx);
    await handler("delete 01 02 03", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Deleted 3 tasks:\n[01] Parent\n[02] Sub\n[03] Another",
      "info",
    );
  });

  it("shows error when deleting nonexistent quest", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("delete ff", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Quest [ff] not found"),
      "error",
    );
  });

  it("blocks batch delete when an incomplete child step is not explicitly selected", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Parent", ctx);
    await handler("add-step 01 Sub", ctx);
    await handler("add Another", ctx);
    await handler("delete 01 03", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Quest [01] has incomplete steps"),
      "error",
    );
  });

  it("clears quests", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add A", ctx);
    await handler("toggle 01", ctx);
    await handler("clear", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Cleared 1 completed quests", "info");
  });

  it("undoes last action", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add A", ctx);
    await handler("undo", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Reverted"), "info");
  });

  it("shows error when nothing to undo", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("undo", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Nothing to undo"), "error");
  });

  it("redoes last undone action", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add A", ctx);
    await handler("undo", ctx);
    await handler("redo", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Redone"), "info");
  });

  it("shows error when nothing to redo", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("redo", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Nothing to redo"), "error");
  });

  it("shows help via notify", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("help", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Available /quests subcommands"),
      "info",
    );
  });

  it("reorders via command", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add A", ctx);
    await handler("add B", ctx);
    await handler("reorder 02 01", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Reordered quest [02]: B", "info");
  });

  it("clears all via command with all arg", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add A", ctx);
    await handler("clear all", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Cleared 1 quests", "info");
  });

  it("shows blocked error when toggling parent with incomplete steps", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Parent", ctx);
    await handler("add-step 01 Sub", ctx);
    await handler("toggle 01", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Quest [01] has incomplete steps"),
      "error",
    );
    expect(ctx.ui.notify).not.toHaveBeenCalledWith("Quest [01] done", "info");
  });

  it("shows blocked error when deleting parent with incomplete steps", async () => {
    const ctx = createMockCtx();
    const handler = createHandler();
    await handler("add Parent", ctx);
    await handler("add-step 01 Sub", ctx);
    await handler("delete 01", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Quest [01] has incomplete steps"),
      "error",
    );
    expect(ctx.ui.notify).not.toHaveBeenCalledWith("Deleted quest [01]: Parent", "info");
  });
});
