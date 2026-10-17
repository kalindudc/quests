import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldStepAside } from "../../extensions/pi/bb-bridge.js";

function writeToolsFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "pi-quests-bridge-")), "pi-tools.json");
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shouldStepAside", () => {
  it("is true when the tools file lists the tool by exact name", () => {
    const file = writeToolsFile(JSON.stringify([{ name: "quests" }, { name: "quest" }]));
    expect(shouldStepAside("quest", file)).toBe(true);
  });

  it("is false when the tools file lists only other tools", () => {
    const file = writeToolsFile(JSON.stringify([{ name: "quests" }, { name: "AskUserQuestion" }]));
    expect(shouldStepAside("quest", file)).toBe(false);
  });

  it("is false when PI_BB_TOOLS_FILE is unset", () => {
    vi.stubEnv("PI_BB_TOOLS_FILE", undefined);
    expect(shouldStepAside("quest")).toBe(false);
  });

  it.each([
    ["the tools file is missing", join(tmpdir(), "pi-quests-missing-tools.json")],
    ["the tools file is malformed", writeToolsFile("{not json")],
    ["the tools file is not an array", writeToolsFile(JSON.stringify({ name: "quest" }))],
  ])("is false when %s", (_case, file) => {
    expect(shouldStepAside("quest", file)).toBe(false);
  });

  it("reads PI_BB_TOOLS_FILE by default", () => {
    vi.stubEnv("PI_BB_TOOLS_FILE", writeToolsFile(JSON.stringify([{ name: "quest" }])));
    expect(shouldStepAside("quest")).toBe(true);
  });
});
