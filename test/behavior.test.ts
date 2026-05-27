import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQuestsHandler } from "../src/commands/handler.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { QuestLog } from "../src/quest/dataplane.js";
import { QUEST_ACTIONS } from "../src/quest/types.js";
import { questToolExecute } from "../src/tools/handler.js";

vi.mock("../src/logger.js", () => ({ logger: { debug: vi.fn() } }));

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

function createMockCtx() {
  return {
    ui: {
      notify: vi.fn(),
      custom: vi.fn().mockResolvedValue(undefined),
    },
    hasUI: true,
  } as unknown as Parameters<ReturnType<typeof createQuestsHandler>>[1];
}

function createCommandHandler(log: QuestLog) {
  return createQuestsHandler(
    { sendMessage: vi.fn() } as unknown as Parameters<typeof createQuestsHandler>[0],
    log,
    DEFAULT_CONFIG,
  );
}

describe("quest behavior", () => {
  describe("command flow", () => {
    it("adds a quest via command and lists it through the dataplane", async () => {
      const log = new QuestLog();
      const handler = createCommandHandler(log);
      const ctx = createMockCtx();

      await handler("add Test quest", ctx);
      expect(log.getAll()).toHaveLength(1);
      expect(log.getAll()[0]!.description).toBe("Test quest");
      expect(ctx.ui.notify).toHaveBeenCalledWith("Added quest [01]: Test quest", "info");

      await handler("list", ctx);
      expect(ctx.ui.custom).toHaveBeenCalled();
    });

    it("toggles and reverts through the command adapter", async () => {
      const log = new QuestLog();
      const handler = createCommandHandler(log);
      const ctx = createMockCtx();

      await handler("add Toggle me", ctx);
      await handler("toggle 01", ctx);
      expect(log.getAll()[0]!.done).toBe(true);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Quest [01] done", "info");

      await handler("undo", ctx);
      expect(log.getAll()[0]!.done).toBe(false);
    });

    it("toggles multiple tasks through the command adapter", async () => {
      const log = new QuestLog();
      const handler = createCommandHandler(log);
      const ctx = createMockCtx();

      await handler("add Parent", ctx);
      await handler("add-step 01 Sub", ctx);
      await handler("toggle 01 02", ctx);

      expect(log.getAll()).toHaveLength(2);
      expect(log.getAll().every((quest) => quest.done)).toBe(true);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Toggled 2 tasks:\n[01] done\n[02] done", "info");
    });

    it("deletes multiple tasks through the command adapter when child steps are explicitly selected", async () => {
      const log = new QuestLog();
      const handler = createCommandHandler(log);
      const ctx = createMockCtx();

      await handler("add Parent", ctx);
      await handler("add-step 01 Sub", ctx);
      await handler("add Another", ctx);
      await handler("delete 01 02 03", ctx);

      expect(log.getAll()).toHaveLength(0);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Deleted 3 tasks:\n[01] Parent\n[02] Sub\n[03] Another",
        "info",
      );
    });

    it("reconstructs session state and continues accepting commands", async () => {
      const log = new QuestLog();
      const entries = [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "quest",
            details: {
              quests: [{ id: "01", description: "Restored", done: false, createdAt: 1 }],
            },
          },
        },
      ];
      const ctx = createMockCtx();
      const sessionCtx = {
        sessionManager: { getBranch: vi.fn().mockReturnValue(entries) },
      } as unknown as ExtensionContext;

      log.reconstructFromSession(sessionCtx);
      expect(log.getAll()).toHaveLength(1);

      const handler = createCommandHandler(log);
      await handler("toggle 01", ctx);
      expect(log.getAll()[0]!.done).toBe(true);
    });
  });

  describe("tool flow", () => {
    it("adds a quest via tool and toggles it", async () => {
      const log = new QuestLog();
      await questToolExecute(log, "tc1", {
        action: QUEST_ACTIONS.add,
        descriptions: ["Test"],
      });
      expect(log.getAll()).toHaveLength(1);

      const result = await questToolExecute(log, "tc2", {
        action: QUEST_ACTIONS.toggle,
        id: "01",
      });
      expect(log.getAll()[0]!.done).toBe(true);
      expect(getText(result.content[0]!)).toContain("Quest [01] done");
    });

    it("batch add then clear restores correctly via revert", async () => {
      const log = new QuestLog();
      await questToolExecute(log, "tc1", {
        action: QUEST_ACTIONS.add,
        descriptions: ["A", "B"],
      });
      expect(log.getAll()).toHaveLength(2);

      await questToolExecute(log, "tc2", { action: QUEST_ACTIONS.clear, all: true });
      expect(log.getAll()).toHaveLength(0);

      const result = await questToolExecute(log, "tc3", { action: QUEST_ACTIONS.undo });
      expect(log.getAll()).toHaveLength(2);
      expect(getText(result.content[0]!)).toContain("Reverted clear");
    });

    it("end-to-end adds parent and step, blocks parent toggle, toggles step, then toggles parent", async () => {
      const log = new QuestLog();
      await questToolExecute(log, "tc1", {
        action: QUEST_ACTIONS.add,
        descriptions: ["Parent"],
      });
      await questToolExecute(log, "tc2", {
        action: QUEST_ACTIONS.split,
        id: "01",
        descriptions: ["Sub"],
      });
      expect(log.getAll()).toHaveLength(2);

      const blocked = await questToolExecute(log, "tc3", {
        action: QUEST_ACTIONS.toggle,
        id: "01",
      });
      expect(getText(blocked.content[0]!)).toContain("incomplete steps");
      expect(log.getAll()[0]!.done).toBe(false);

      await questToolExecute(log, "tc4", {
        action: QUEST_ACTIONS.toggle,
        id: "02",
      });
      expect(log.getAll()[1]!.done).toBe(true);

      const ok = await questToolExecute(log, "tc5", {
        action: QUEST_ACTIONS.toggle,
        id: "01",
      });
      expect(getText(ok.content[0]!)).toContain("Quest [01] done");
      expect(log.getAll()[0]!.done).toBe(true);
    });

    it("end-to-end batch toggles a parent and step together", async () => {
      const log = new QuestLog();
      await questToolExecute(log, "tc1", {
        action: QUEST_ACTIONS.add,
        descriptions: ["Parent"],
      });
      await questToolExecute(log, "tc2", {
        action: QUEST_ACTIONS.split,
        id: "01",
        descriptions: ["Sub"],
      });

      const result = await questToolExecute(log, "tc3", {
        action: QUEST_ACTIONS.toggle,
        ids: ["01", "02"],
      });

      expect(getText(result.content[0]!)).toContain("Toggled 2 tasks");
      expect(log.getAll().every((quest) => quest.done)).toBe(true);
    });

    it("end-to-end batch deletes a parent and another task when the child step is explicitly selected", async () => {
      const log = new QuestLog();
      await questToolExecute(log, "tc1", {
        action: QUEST_ACTIONS.add,
        descriptions: ["Parent"],
      });
      await questToolExecute(log, "tc2", {
        action: QUEST_ACTIONS.split,
        id: "01",
        descriptions: ["Sub"],
      });
      await questToolExecute(log, "tc3", {
        action: QUEST_ACTIONS.add,
        descriptions: ["Another"],
      });

      const result = await questToolExecute(log, "tc4", {
        action: QUEST_ACTIONS.delete,
        ids: ["01", "02", "03"],
      });

      expect(getText(result.content[0]!)).toContain("Deleted 3 tasks");
      expect(log.getAll()).toHaveLength(0);
    });
  });
});

function getText(content: { type: "text"; text: string } | { type: "image" }): string | undefined {
  return content.type === "text" ? content.text : undefined;
}
