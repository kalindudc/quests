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
  formatQuestList,
  formatReorderNotFoundError,
  formatStepCannotHaveSteps,
  formatTargetIdRequiredError,
  formatToggleResult,
  formatUnknownActionError,
  formatUpdateResult,
} from "../../../src/quest/formatters.js";

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
