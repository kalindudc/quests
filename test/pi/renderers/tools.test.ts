import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../../extensions/pi/config.js";
import {
  COLLAPSED_PREVIEW_LINES,
  renderQuestCall,
  renderQuestResult,
} from "../../../extensions/pi/renderers/tools.js";
import { QuestLog } from "../../../src/quest/dataplane.js";
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

vi.mock("../../../extensions/pi/logger.js", () => ({ logger: { debug: vi.fn() } }));

// keyHint reads pi's global theme/keybindings, which are only initialised inside a live TUI.
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    keyHint: (keybinding: string, description: string) => `${keybinding} ${description}`,
  };
});

const mockTheme = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
  strikethrough: (text: string) => text,
} as unknown as Theme;

function getText(widget: Text): string {
  return (widget as unknown as { text: string }).text;
}

describe("renderQuestCall", () => {
  it("renders add action with descriptions count", () => {
    const result = renderQuestCall(
      { action: QUEST_ACTIONS.add, descriptions: ["Test quest"] },
      mockTheme,
      {},
    );
    expect(getText(result)).toContain("quest add");
    expect(getText(result)).toContain("[1 quest]");
  });

  it("renders batch add with count", () => {
    const result = renderQuestCall(
      { action: QUEST_ACTIONS.add, descriptions: ["A", "B"] },
      mockTheme,
      {},
    );
    expect(getText(result)).toContain("quest add");
    expect(getText(result)).toContain("[2 quests]");
  });

  it("renders toggle action with id", () => {
    const result = renderQuestCall({ action: QUEST_ACTIONS.toggle, id: "03" }, mockTheme, {});
    expect(getText(result)).toContain("quest toggle");
    expect(getText(result)).toContain("[03]");
  });

  it("renders batch toggle action with count", () => {
    const result = renderQuestCall(
      { action: QUEST_ACTIONS.toggle, ids: ["03", "04"] },
      mockTheme,
      {},
    );
    expect(getText(result)).toContain("quest toggle");
    expect(getText(result)).toContain("[2 tasks]");
  });

  it("renders single toggle action from ids", () => {
    const result = renderQuestCall({ action: QUEST_ACTIONS.toggle, ids: ["03"] }, mockTheme, {});
    expect(getText(result)).toContain("quest toggle");
    expect(getText(result)).toContain("[03]");
  });

  it("renders undo action", () => {
    const result = renderQuestCall({ action: QUEST_ACTIONS.undo }, mockTheme, {});
    expect(getText(result)).toContain("quest undo");
  });

  it("renders redo action", () => {
    const result = renderQuestCall({ action: QUEST_ACTIONS.redo }, mockTheme, {});
    expect(getText(result)).toContain("quest redo");
  });

  it("renders reorder action with targetId", () => {
    const result = renderQuestCall(
      { action: QUEST_ACTIONS.reorder, targetId: "01" },
      mockTheme,
      {},
    );
    expect(getText(result)).toContain("quest reorder");
    expect(getText(result)).toContain("01");
  });

  it("renders batch delete action with count", () => {
    const result = renderQuestCall(
      { action: QUEST_ACTIONS.delete, ids: ["03", "04"] },
      mockTheme,
      {},
    );
    expect(getText(result)).toContain("quest delete");
    expect(getText(result)).toContain("[2 tasks]");
  });

  it("renders single delete action from ids", () => {
    const result = renderQuestCall({ action: QUEST_ACTIONS.delete, ids: ["03"] }, mockTheme, {});
    expect(getText(result)).toContain("quest delete");
    expect(getText(result)).toContain("[03]");
  });

  it("renders clear action", () => {
    const result = renderQuestCall({ action: QUEST_ACTIONS.clear, all: true }, mockTheme, {});
    expect(getText(result)).toContain("quest clear");
    expect(getText(result)).toContain("[all]");
  });

  it("renders clear action without all flag", () => {
    const result = renderQuestCall({ action: QUEST_ACTIONS.clear, all: false }, mockTheme, {});
    expect(getText(result)).toContain("quest clear");
    expect(getText(result)).toContain("[done]");
  });
});

describe("renderQuestResult", () => {
  const render = renderQuestResult(DEFAULT_CONFIG);

  it("renders full quest list with positional numbers and hex ids", () => {
    const log = new QuestLog();
    log.add("Done quest");
    log.toggle("01");
    log.add("Pending quest");
    const toolResult: AgentToolResult<unknown> = {
      content: [{ type: "text", text: "" }],
      details: {
        quests: log.getAll(),
      },
    };
    const result = render(toolResult, { expanded: false, isPartial: false }, mockTheme, {});
    const text = getText(result);
    expect(text).toContain("[01] #1");
    expect(text).toContain("Done quest");
    expect(text).toContain("[02] #2");
    expect(text).toContain("Pending quest");
  });

  it("renders displayQuests with positional numbers and hex ids from full list", () => {
    const log = new QuestLog();
    log.add("Done quest");
    log.toggle("01");
    log.add("Pending quest");
    const toolResult: AgentToolResult<unknown> = {
      content: [{ type: "text", text: "" }],
      details: {
        quests: log.getAll(),
        displayQuests: [log.getAll()[1]!],
      },
    };
    const result = render(toolResult, { expanded: false, isPartial: false }, mockTheme, {});
    const text = getText(result);
    expect(text).not.toContain("[01] #1");
    expect(text).not.toContain("Done quest");
    expect(text).toContain("[02] #2");
    expect(text).toContain("Pending quest");
  });

  it("falls back to plain text when no quests are present", () => {
    const result = render(
      {
        content: [{ type: "text", text: "All clear" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mockTheme,
      {},
    );
    expect(getText(result)).toContain("All clear");
  });

  it("renders delete snapshots even when the live quest list is empty", () => {
    const result = render(
      {
        content: [{ type: "text", text: "Deleted 2 tasks" }],
        details: {
          quests: [],
          displayQuests: [
            { id: "01", description: "Parent", done: false, createdAt: 1 },
            { id: "02", description: "Sub", done: false, createdAt: 2, parentId: "01" },
          ],
          snapshotQuests: [
            { id: "01", description: "Parent", done: false, createdAt: 1 },
            { id: "02", description: "Sub", done: false, createdAt: 2, parentId: "01" },
          ],
        },
      },
      { expanded: false, isPartial: false },
      mockTheme,
      {},
    );
    const text = getText(result);
    expect(text).toContain("Parent");
    expect(text).toContain("Sub");
  });

  it("renders steps indented without positional numbers", () => {
    const log = new QuestLog();
    log.add("Parent");
    log.addStep("Sub", "01");
    const toolResult: AgentToolResult<unknown> = {
      content: [{ type: "text", text: "" }],
      details: {
        quests: log.getAll(),
      },
    };
    const result = render(toolResult, { expanded: false, isPartial: false }, mockTheme, {});
    const text = getText(result);
    expect(text).toContain("[01] #1");
    expect(text).toContain("[02]");
    expect(text).toContain("Sub");
    expect(text).not.toContain("#2");
  });

  it("adds blank lines around step groups", () => {
    const log = new QuestLog();
    log.add("Parent A");
    log.addStep("Sub A1", "01");
    log.addStep("Sub A2", "01");
    log.add("Parent B");
    const toolResult: AgentToolResult<unknown> = {
      content: [{ type: "text", text: "" }],
      details: {
        quests: log.getAll(),
      },
    };
    const result = render(toolResult, { expanded: false, isPartial: false }, mockTheme, {});
    const text = getText(result);
    const lines = text.split("\n");
    const parentAIdx = lines.findIndex((l) => l.includes("Parent A"));
    const subA1Idx = lines.findIndex((l) => l.includes("Sub A1"));
    const subA2Idx = lines.findIndex((l) => l.includes("Sub A2"));
    const parentBIdx = lines.findIndex((l) => l.includes("Parent B"));

    expect(lines[subA1Idx - 1]).contain("│");
    expect(lines[subA2Idx + 1]).toBe("");
    expect(subA1Idx).toBe(parentAIdx + 2);
    expect(parentBIdx).toBe(subA2Idx + 2);
  });

  describe("collapsed vs expanded", () => {
    const EXPAND_HINT = "app.tools.expand to expand";

    function longQuestList(count: number): AgentToolResult<unknown> {
      const log = new QuestLog();
      for (let i = 1; i <= count; i++) log.add(`Quest ${i}`);
      return { content: [{ type: "text", text: "" }], details: { quests: log.getAll() } };
    }

    it("collapsed view truncates a long quest list and appends the expand hint", () => {
      const total = COLLAPSED_PREVIEW_LINES + 3;
      const result = render(
        longQuestList(total),
        { expanded: false, isPartial: false },
        mockTheme,
        {},
      );
      const lines = getText(result).split("\n");

      expect(lines).toHaveLength(COLLAPSED_PREVIEW_LINES + 1);
      expect(lines[COLLAPSED_PREVIEW_LINES - 1]).toContain(`Quest ${COLLAPSED_PREVIEW_LINES}`);
      expect(lines[COLLAPSED_PREVIEW_LINES]).toContain("... (3 more lines,");
      expect(lines[COLLAPSED_PREVIEW_LINES]).toContain(EXPAND_HINT);
      expect(getText(result)).not.toContain(`Quest ${total}`);
    });

    it("expanded view renders every quest without a hint", () => {
      const total = COLLAPSED_PREVIEW_LINES + 3;
      const result = render(
        longQuestList(total),
        { expanded: true, isPartial: false },
        mockTheme,
        {},
      );
      const text = getText(result);

      expect(text.split("\n")).toHaveLength(total);
      expect(text).toContain(`Quest ${total}`);
      expect(text).not.toContain("more lines");
      expect(text).not.toContain(EXPAND_HINT);
    });

    it("collapsed view renders a short quest list in full without a hint", () => {
      const result = render(
        longQuestList(COLLAPSED_PREVIEW_LINES),
        { expanded: false, isPartial: false },
        mockTheme,
        {},
      );
      const text = getText(result);

      expect(text.split("\n")).toHaveLength(COLLAPSED_PREVIEW_LINES);
      expect(text).toContain(`Quest ${COLLAPSED_PREVIEW_LINES}`);
      expect(text).not.toContain(EXPAND_HINT);
    });

    it("counts spacer and separator lines of step groups as rendered lines", () => {
      // 3 parents x (parent + spacer + 2 steps) + 2 blank separators = 14 lines
      const log = new QuestLog();
      for (let i = 1; i <= 3; i++) {
        const parent = log.add(`Parent ${i}`);
        log.addStep(`Step ${i}a`, parent.id);
        log.addStep(`Step ${i}b`, parent.id);
      }
      const toolResult: AgentToolResult<unknown> = {
        content: [{ type: "text", text: "" }],
        details: { quests: log.getAll() },
      };

      const collapsed = getText(
        render(toolResult, { expanded: false, isPartial: false }, mockTheme, {}),
      );
      const expanded = getText(
        render(toolResult, { expanded: true, isPartial: false }, mockTheme, {}),
      );

      expect(expanded.split("\n")).toHaveLength(14);
      expect(collapsed.split("\n")).toHaveLength(COLLAPSED_PREVIEW_LINES + 1);
      expect(collapsed).toContain(`... (${14 - COLLAPSED_PREVIEW_LINES} more lines,`);
      expect(collapsed).not.toContain("Parent 3");
    });

    it("collapses long plain-text results such as the skill document", () => {
      const total = COLLAPSED_PREVIEW_LINES + 5;
      const doc = Array.from({ length: total }, (_, i) => `Rule ${i + 1}`).join("\n");
      const toolResult: AgentToolResult<unknown> = {
        content: [{ type: "text", text: doc }],
        details: { quests: [], displayQuests: [] },
      };

      const collapsed = getText(
        render(toolResult, { expanded: false, isPartial: false }, mockTheme, {}),
      );
      const expanded = getText(
        render(toolResult, { expanded: true, isPartial: false }, mockTheme, {}),
      );

      expect(collapsed.split("\n")).toHaveLength(COLLAPSED_PREVIEW_LINES + 1);
      expect(collapsed).toContain("Rule 1");
      expect(collapsed).not.toContain(`Rule ${total}`);
      expect(collapsed).toContain("... (5 more lines,");
      expect(collapsed).toContain(EXPAND_HINT);

      expect(expanded.split("\n")).toHaveLength(total);
      expect(expanded).toContain(`Rule ${total}`);
      expect(expanded).not.toContain(EXPAND_HINT);
    });
  });
});
