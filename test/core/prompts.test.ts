import { describe, expect, it } from "vitest";
import {
  formatQuestNote,
  formatUserChanges,
  QUEST_INSTRUCTIONS,
  USER_CHANGES_PREFIX,
} from "../../src/prompts.js";
import type { Quest, Step } from "../../src/quest/types.js";

const quest = (id: string, description: string, done = false): Quest => ({
  id,
  description,
  done,
  createdAt: 0,
});
const step = (id: string, parentId: string, description: string, done = false): Step => ({
  ...quest(id, description, done),
  parentId,
});

describe("QUEST_INSTRUCTIONS", () => {
  it("stays short enough to sit in every thread's instructions", () => {
    expect(QUEST_INSTRUCTIONS.join("\n").length).toBeLessThan(1300);
  });

  it("names the moments to revisit the log and when to skip quests", () => {
    const text = QUEST_INSTRUCTIONS.join("\n");
    expect(text).toContain("when the user redirects");
    expect(text).toContain("before your final answer");
    expect(text).toContain("Skip them for a single-pass answer");
  });
});

describe("formatUserChanges", () => {
  it("lists each change under the prefix, indenting continuation lines", () => {
    expect(formatUserChanges(["Quest [01] done", "Added 2 quests:\n[02]: A"])).toBe(
      `${USER_CHANGES_PREFIX}\n- Quest [01] done\n- Added 2 quests:\n  [02]: A`,
    );
  });
});

describe("formatQuestNote", () => {
  const quests = [
    quest("01", "Survey", true),
    quest("02", "Build"),
    step("03", "02", "Server", true),
    step("04", "02", "Page"),
    quest("05", "Verify"),
  ];

  it("gives a stale log's state and says why it was sent", () => {
    expect(formatQuestNote(quests, { stale: true, userChanges: [] })).toBe(
      [
        "[Quests] 2 of 5 done. Next: [04] Page (a step of [02])",
        "Open: [02] Build (1 of 2 steps done); [05] Verify.",
        "You have not updated the quests since the user's previous message. If this request changes the plan, update them; if not, carry on.",
      ].join("\n"),
    );
  });

  it("carries the user's edits without calling the log stale", () => {
    const note = formatQuestNote(quests, { stale: false, userChanges: ["Quest [05] done"] });
    expect(note).toContain(`${USER_CHANGES_PREFIX}\n- Quest [05] done`);
    expect(note).not.toContain("have not updated");
  });

  it("lists at most five open quests", () => {
    const many = Array.from({ length: 7 }, (_, index) => quest(`1${index}`, `Q${index}`));
    expect(formatQuestNote(many, { stale: true, userChanges: [] })).toContain(
      "[14] Q4; and 2 more.",
    );
  });
});
