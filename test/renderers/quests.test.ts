import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { QuestLog } from "../../src/quest/dataplane.js";
import type { Quest, Step } from "../../src/quest/types.js";
import { QuestListWidget } from "../../src/renderers/commands.js";
import { formatQuestRow, formatStepSpacerLine } from "../../src/renderers/quests.js";

const mockTheme = {
  fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  bold: (text: string) => `**${text}**`,
  strikethrough: (text: string) => `~~${text}~~`,
} as unknown as Theme;

// Remove the mock theme's decoration so we can measure visible layout.
const strip = (s: string): string =>
  s
    .replace(/\[\/?(?:muted|accent|dim|success|text)\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/~~/g, "");

const quest = (id: string, description: string): Quest => ({
  id,
  description,
  done: false,
  createdAt: 0,
});

const step = (id: string, parentId: string, description: string): Step => ({
  id,
  description,
  done: false,
  createdAt: 0,
  parentId,
});

describe("formatQuestRow", () => {
  // Regression: `spacing = " ".repeat(reserved - posWidth)` underflowed to -1
  // once a position label (e.g. "#100") was wider than the reserved column,
  // throwing `RangeError: Invalid count value: -1` and crashing the TUI.
  it("does not throw for any position across the full ID range", () => {
    const q = quest("e7", "Investigate");
    for (let pos = 1; pos <= 300; pos++) {
      expect(() => formatQuestRow(mockTheme, q, 2, pos)).not.toThrow();
    }
  });

  it("keeps the marker aligned regardless of position-label width", () => {
    const q = quest("e7", "desc");
    const row1 = strip(formatQuestRow(mockTheme, q, 2, 1));
    const row100 = strip(formatQuestRow(mockTheme, q, 2, 100));
    const row256 = strip(formatQuestRow(mockTheme, q, 2, 256));

    // The "○" marker must begin at the same column for all positions.
    expect(row1.indexOf("○")).toBeGreaterThan(0);
    expect(row100.indexOf("○")).toBe(row1.indexOf("○"));
    expect(row256.indexOf("○")).toBe(row1.indexOf("○"));
  });

  it("aligns steps with their parent quests", () => {
    const parentRow = strip(formatQuestRow(mockTheme, quest("e7", "parent"), 2, 100));
    const stepRow = strip(formatQuestRow(mockTheme, step("a1", "e7", "child"), 2));
    const spacer = strip(formatStepSpacerLine(mockTheme, 2));

    const markerCol = parentRow.indexOf("○");
    // The step connector "└──" and spacer "│" sit under the parent marker column.
    expect(stepRow.indexOf("└")).toBe(markerCol);
    expect(spacer.indexOf("│")).toBe(markerCol);
  });
});

describe("QuestListWidget", () => {
  // Reproduces the exact crash path: render -> get totalPages ->
  // buildQuestLines -> formatQuestRow(pos=100).
  it("renders 100 quests without throwing", () => {
    const log = new QuestLog();
    for (let i = 1; i <= 100; i++) log.add(`Quest ${i}`);
    const widget = new QuestListWidget(log, mockTheme, () => {}, DEFAULT_CONFIG);

    expect(() => widget.render(80)).not.toThrow();
  });

  it("renders the 100th quest's position label when all fit on a page", () => {
    const log = new QuestLog();
    for (let i = 1; i <= 100; i++) log.add(`Quest ${i}`);
    const config = {
      ...DEFAULT_CONFIG,
      display: { ...DEFAULT_CONFIG.display, pageSize: 200 },
    };
    const widget = new QuestListWidget(log, mockTheme, () => {}, config);

    const lines = widget.render(200);
    expect(strip(lines.join("\n"))).toContain("#100");
  });
});
