import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export interface ResolvedConfig {
  ids: { length: number };
  display: { pageSize: number; progressBarMaxWidth: number; icon: string; showStatus: boolean };
  shortcuts?: { openQuests?: string };
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  ids: { length: 2 },
  display: { pageSize: 10, progressBarMaxWidth: 24, icon: "󰣏", showStatus: true },
  shortcuts: {},
};

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function loadSettings(cwd: string): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  const globalPath = join(getAgentDir(), "settings.json");
  if (existsSync(globalPath)) {
    try {
      Object.assign(settings, JSON.parse(readFileSync(globalPath, "utf-8")));
    } catch {
      /* ignore */
    }
  }
  const projectPath = join(cwd, ".pi", "settings.json");
  if (existsSync(projectPath)) {
    try {
      const project = JSON.parse(readFileSync(projectPath, "utf-8")) as Record<string, unknown>;
      if (project["pi-quests"] && typeof project["pi-quests"] === "object") {
        const globalPiQuests =
          settings["pi-quests"] && typeof settings["pi-quests"] === "object"
            ? (settings["pi-quests"] as Record<string, unknown>)
            : {};
        settings["pi-quests"] = deepMerge(
          globalPiQuests,
          project["pi-quests"] as Record<string, unknown>,
        );
      }
    } catch {
      /* ignore */
    }
  }
  return settings;
}

export function getConfig(ctx: Pick<ExtensionContext, "cwd">): ResolvedConfig {
  const settings = loadSettings(ctx.cwd);
  const user = (settings["pi-quests"] ?? {}) as Partial<ResolvedConfig>;
  return {
    ids: { length: user.ids?.length ?? DEFAULT_CONFIG.ids.length },
    display: {
      pageSize: user.display?.pageSize ?? DEFAULT_CONFIG.display.pageSize,
      progressBarMaxWidth:
        user.display?.progressBarMaxWidth ?? DEFAULT_CONFIG.display.progressBarMaxWidth,
      icon: user.display?.icon ?? DEFAULT_CONFIG.display.icon,
      showStatus: user.display?.showStatus ?? DEFAULT_CONFIG.display.showStatus,
    },
    shortcuts: {
      openQuests: user.shortcuts?.openQuests,
    },
  };
}
