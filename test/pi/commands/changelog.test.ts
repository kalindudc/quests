import { describe, expect, it } from "vitest";
import { reverseChangelog } from "../../../extensions/pi/commands/changelog.js";

describe("reverseChangelog", () => {
  it("returns empty string for empty input", () => {
    expect(reverseChangelog("")).toBe("");
  });

  it("returns the same content for a single section", () => {
    const input = "## [1.0.0]\n- Feature A\n";
    expect(reverseChangelog(input)).toBe(input);
  });

  it("reverses multiple sections", () => {
    const input = "## [1.0.0]\n- A\n\n## [0.2.0]\n- B\n\n## [0.1.0]\n- C\n";
    const expected = "## [0.1.0]\n- C\n## [0.2.0]\n- B\n\n## [1.0.0]\n- A\n\n";
    expect(reverseChangelog(input)).toBe(expected);
  });

  it("preserves header before first section", () => {
    const input = "# Changelog\n\n## [1.0.0]\n- A\n\n## [0.1.0]\n- B\n";
    const expected = "# Changelog\n\n## [0.1.0]\n- B\n## [1.0.0]\n- A\n\n";
    expect(reverseChangelog(input)).toBe(expected);
  });
});
