import { describe, expect, it } from "vitest";
import {
  formatAddResult,
  formatBatchAddResult,
  formatBatchDeleteResult,
  formatBatchToggleResult,
  formatBlockedBySteps,
  formatDeleteResult,
  formatDescriptionRequiredError,
  formatEmptyDescriptionsError,
  formatIdRequiredError,
  formatMissingDescriptionsError,
  formatNotFound,
  formatNothingToRedoError,
  formatNothingToUndoError,
  formatParentDoneError,
  formatParentNotFoundError,
  formatPlanStatus,
  formatQuestList,
  formatReorderNotFoundError,
  formatSplitResult,
  formatStepCannotHaveSteps,
  formatTargetIdRequiredError,
  formatToggleResult,
  formatToolResult,
  formatUnknownActionError,
  formatUpdateResult,
} from "../../../src/quest/formatters.js";
import type { Quest, Step } from "../../../src/quest/types.js";

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

describe("formatQuestList", () => {
  it("renders quests with positional numbers and hex ids", () => {
    const result = formatQuestList([
      { id: "05", description: "A", done: true },
      { id: "0a", description: "B", done: false },
    ]);
    expect(result).toBe("#1 [05] [x] A\n#2 [0a] [ ] B");
  });

  it("shows empty state", () => {
    expect(formatQuestList([])).toBe("No quests.");
  });

  it("skips positional numbers for steps and indents them", () => {
    const result = formatQuestList([
      { id: "01", description: "Parent", done: false },
      { id: "02", description: "Sub", done: false, parentId: "01" },
    ]);
    expect(result).toBe("#1 [01] [ ] Parent\n   [02] [ ] Sub");
  });
});

describe("formatAddResult", () => {
  it("formats correctly", () => {
    expect(formatAddResult({ id: "01", description: "Test" })).toBe("Added quest [01]: Test");
  });
});

describe("formatBatchAddResult", () => {
  it("formats correctly", () => {
    expect(formatBatchAddResult([{ id: "01", description: "A" }])).toBe("Added 1 quests:\n[01]: A");
  });
});

describe("formatToggleResult", () => {
  it("formats done", () => {
    expect(formatToggleResult("01", true)).toBe("Quest [01] done");
  });

  it("formats undone", () => {
    expect(formatToggleResult("01", false)).toBe("Quest [01] undone");
  });
});

describe("formatBatchToggleResult", () => {
  it("formats correctly", () => {
    expect(
      formatBatchToggleResult([
        { id: "01", done: true },
        { id: "02", done: false },
      ]),
    ).toBe("Toggled 2 tasks:\n[01] done\n[02] undone");
  });
});

describe("formatUpdateResult", () => {
  it("formats correctly", () => {
    expect(formatUpdateResult({ id: "01", description: "New" })).toBe("Updated quest [01]: New");
  });
});

describe("formatDeleteResult", () => {
  it("formats correctly", () => {
    expect(formatDeleteResult({ id: "01", description: "Old" })).toBe("Deleted quest [01]: Old");
  });
});

describe("formatBatchDeleteResult", () => {
  it("formats correctly", () => {
    expect(
      formatBatchDeleteResult([
        { id: "01", description: "Parent" },
        { id: "02", description: "Sub" },
      ]),
    ).toBe("Deleted 2 tasks:\n[01] Parent\n[02] Sub");
  });
});

describe("formatNotFound", () => {
  it("includes recovery hint", () => {
    expect(formatNotFound("ff")).toContain("Quest [ff] not found");
    expect(formatNotFound("ff")).toContain("list action");
  });
});

describe("formatBlockedBySteps", () => {
  it("includes recovery hint", () => {
    expect(formatBlockedBySteps("01")).toContain("Quest [01] has incomplete steps");
    expect(formatBlockedBySteps("01")).toContain("steps are complete");
  });
});

describe("formatStepCannotHaveSteps", () => {
  it("includes recovery hint", () => {
    expect(formatStepCannotHaveSteps("02")).toContain("cannot have nested steps");
    expect(formatStepCannotHaveSteps("02")).toContain("one level of nesting");
  });
});

describe("formatEmptyDescriptionsError", () => {
  it("includes recovery hint", () => {
    expect(formatEmptyDescriptionsError()).toContain("non-empty");
  });
});

describe("formatMissingDescriptionsError", () => {
  it("includes recovery hint", () => {
    expect(formatMissingDescriptionsError()).toContain("At least one description is required");
  });
});

describe("formatIdRequiredError", () => {
  it("includes recovery hint", () => {
    expect(formatIdRequiredError("toggle")).toContain("id is required");
    expect(formatIdRequiredError("toggle")).toContain("list action");
  });
});

describe("formatDescriptionRequiredError", () => {
  it("includes recovery hint", () => {
    expect(formatDescriptionRequiredError()).toContain("description is required");
  });
});

describe("formatTargetIdRequiredError", () => {
  it("includes recovery hint", () => {
    expect(formatTargetIdRequiredError()).toContain("targetId is required");
  });
});

describe("formatReorderNotFoundError", () => {
  it("includes recovery hint", () => {
    expect(formatReorderNotFoundError()).toContain("Reorder only works on top-level quests");
  });
});

describe("formatParentNotFoundError", () => {
  it("includes recovery hint", () => {
    expect(formatParentNotFoundError("ff")).toContain("not found");
    expect(formatParentNotFoundError("ff")).toContain("list action");
  });
});

describe("formatParentDoneError", () => {
  it("includes recovery hint", () => {
    expect(formatParentDoneError("01")).toContain("completed parent quest");
    expect(formatParentDoneError("01")).toContain("open parents");
  });
});

describe("formatUnknownActionError", () => {
  it("includes recovery hint", () => {
    expect(formatUnknownActionError("fly")).toContain("Unknown action: fly");
  });
});

describe("formatNothingToUndoError", () => {
  it("includes recovery hint", () => {
    expect(formatNothingToUndoError()).toContain("Nothing to undo");
  });
});

describe("formatNothingToRedoError", () => {
  it("includes recovery hint", () => {
    expect(formatNothingToRedoError()).toContain("Nothing to redo");
  });
});

describe("formatSplitResult", () => {
  it("lists every new step with its id", () => {
    expect(
      formatSplitResult("0a", [
        { id: "10", description: "A" },
        { id: "11", description: "B" },
      ]),
    ).toBe("Split quest [0a] into 2 steps:\n[10]: A\n[11]: B");
  });

  it("uses the singular for one step", () => {
    expect(formatSplitResult("0a", [{ id: "10", description: "A" }])).toBe(
      "Split quest [0a] into 1 step:\n[10]: A",
    );
  });
});

describe("formatPlanStatus", () => {
  it("says when the log is empty", () => {
    expect(formatPlanStatus([])).toBe("The quest log is empty.");
  });

  it("names the first open step of the first open quest", () => {
    const quests = [
      quest("01", "Done", true),
      quest("02", "Build"),
      step("03", "02", "Server", true),
      step("04", "02", "Page"),
      quest("05", "Verify"),
    ];
    expect(formatPlanStatus(quests)).toBe("2 of 5 done. Next: [04] Page (a step of [02])");
  });

  it("asks for the parent once its steps are all done", () => {
    const quests = [quest("02", "Build"), step("03", "02", "Server", true)];
    expect(formatPlanStatus(quests)).toBe(
      "1 of 2 done. Next: [02] Build (all its steps are done; toggle it once the quest itself is complete)",
    );
  });

  it("names a plain open quest without a note", () => {
    expect(formatPlanStatus([quest("01", "Ship")])).toBe("0 of 1 done. Next: [01] Ship");
  });

  it("says when every quest is done", () => {
    expect(formatPlanStatus([quest("01", "Ship", true)])).toBe("1 of 1 done. Every quest is done.");
  });

  it("shortens a long next description", () => {
    const status = formatPlanStatus([quest("01", "x".repeat(200))]);
    expect(status).toBe(`0 of 1 done. Next: [01] ${"x".repeat(79)}…`);
  });
});

describe("formatToolResult", () => {
  const quests = [quest("01", "Ship")];

  it("adds the plan status to a successful change", () => {
    expect(formatToolResult("toggle", { success: true, message: "Quest [02] done" }, quests)).toBe(
      "Quest [02] done\n0 of 1 done. Next: [01] Ship",
    );
  });

  it("leaves failures, lists and the skill document alone", () => {
    expect(formatToolResult("toggle", { success: false, message: "nope" }, quests)).toBe("nope");
    expect(formatToolResult("list", { success: true, message: "#1" }, quests)).toBe("#1");
    expect(formatToolResult("skill", { success: true, message: "doc" }, quests)).toBe("doc");
  });
});
