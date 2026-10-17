import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The pi package ships src/ beside extensions/pi/, so the core skill is two levels up.
const SKILL_PATH = fileURLToPath(
  new URL("../../src/skills/quest-management/SKILL.md", import.meta.url),
);

export function getQuestSkillDocument(): string {
  return readFileSync(SKILL_PATH, "utf-8");
}
