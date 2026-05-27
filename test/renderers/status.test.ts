import { describe, expect, it, vi } from "vitest";
import { QuestLog } from "../../src/quest/dataplane.js";
import { QuestStatusWidget } from "../../src/renderers/status.js";

const mockTheme = {
  fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  bold: (text: string) => `**${text}**`,
  strikethrough: (text: string) => `~~${text}~~`,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

describe("QuestStatusWidget", () => {
  it("hides status when no quests exist", () => {
    const widget = new QuestStatusWidget("󰣏");
    const ui = { setStatus: vi.fn() };
    widget.update(new QuestLog(), ui, mockTheme);
    expect(ui.setStatus).toHaveBeenCalledWith("pi-quests", undefined);
  });

  it("shows icon, progress bar and count for active quests", () => {
    const widget = new QuestStatusWidget("󰣏");
    const ui = { setStatus: vi.fn() };
    const log = new QuestLog();
    log.add("First");
    const second = log.add("Second");
    log.toggle(second.id);
    widget.update(log, ui, mockTheme);
    expect(ui.setStatus).toHaveBeenCalledWith("pi-quests", expect.stringContaining("󰣏"));
    expect(ui.setStatus).toHaveBeenCalledWith("pi-quests", expect.stringContaining("1/2"));
  });

  it("uses custom icon when provided", () => {
    const widget = new QuestStatusWidget("★");
    const ui = { setStatus: vi.fn() };
    const log = new QuestLog();
    log.add("One");
    widget.update(log, ui, mockTheme);
    expect(ui.setStatus).toHaveBeenCalledWith("pi-quests", expect.stringContaining("★"));
  });

  it("does not call setStatus when disabled via the enabled flag", () => {
    const widget = new QuestStatusWidget("󰣏", false);
    const ui = { setStatus: vi.fn() };
    const log = new QuestLog();
    log.add("One");
    widget.update(log, ui, mockTheme);
    expect(ui.setStatus).not.toHaveBeenCalled();
  });
});
