import { type AgentToolResult, keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ResolvedConfig } from "../config.js";
import { logger } from "../logger.js";
import type { Quest } from "../quest/types.js";
import { QUEST_ACTIONS } from "../quest/types.js";
import { formatQuestRow, formatStepSpacerLine } from "./quests.js";

type QuestArgs = {
  action: string;
  descriptions?: string[];
  targetId?: string;
  id?: string;
  ids?: string[];
  all?: boolean;
};

/**
 * Maximum number of result lines shown while a tool row is collapsed.
 * Matches pi's default fallback preview so quest output behaves like built-in tools.
 */
export const COLLAPSED_PREVIEW_LINES = 10;

/**
 * Applies pi's standard compact-view treatment: the collapsed view shows a preview and an
 * expand hint (`app.tools.expand`, ctrl+o by default); the expanded view shows every line.
 */
function collapseLines(lines: string[], expanded: boolean, theme: Theme): string {
  if (expanded || lines.length <= COLLAPSED_PREVIEW_LINES) return lines.join("\n");

  const displayLines = lines.slice(0, COLLAPSED_PREVIEW_LINES);
  const remaining = lines.length - displayLines.length;
  const hint =
    theme.fg("muted", `... (${remaining} more lines,`) +
    ` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;

  return `${displayLines.join("\n")}\n${hint}`;
}

export function renderQuestCall(args: QuestArgs, theme: Theme, _context: unknown): Text {
  const id = "id" in args ? args.id : undefined;
  logger.debug("quests:tool", "renderCall", { action: args.action, id });
  const actionText =
    theme.fg("toolTitle", theme.bold("quest ")) +
    theme.fg("accent", args.action) +
    theme.fg("muted", args.targetId ? ` ${args.targetId}` : "");

  if (args.action === QUEST_ACTIONS.add && args.descriptions && args.descriptions.length > 0) {
    const n = args.descriptions.length;
    return new Text(
      `${actionText} ${theme.fg("muted", `[${n} quest${n !== 1 ? "s" : ""}]`)}`,
      0,
      0,
    );
  }

  if (args.action === QUEST_ACTIONS.toggle) {
    if (args.ids && args.ids.length > 1) {
      return new Text(`${actionText} ${theme.fg("muted", `[${args.ids.length} tasks]`)}`, 0, 0);
    }

    const toggleId = args.id ?? args.ids?.[0];
    if (toggleId !== undefined) {
      return new Text(`${actionText} ${theme.fg("muted", `[${toggleId}]`)}`, 0, 0);
    }
  }

  if (args.action === QUEST_ACTIONS.delete) {
    if (args.ids && args.ids.length > 1) {
      return new Text(`${actionText} ${theme.fg("muted", `[${args.ids.length} tasks]`)}`, 0, 0);
    }

    const deleteId = args.id ?? args.ids?.[0];
    if (deleteId !== undefined) {
      return new Text(`${actionText} ${theme.fg("muted", `[${deleteId}]`)}`, 0, 0);
    }
  }

  if (args.action === QUEST_ACTIONS.update && args.id !== undefined) {
    return new Text(`${actionText} ${theme.fg("muted", `[${args.id}]`)}`, 0, 0);
  }

  if (args.action === QUEST_ACTIONS.clear) {
    return new Text(`${actionText} ${theme.fg("muted", `[${args.all ? "all" : "done"}]`)}`, 0, 0);
  }

  return new Text(actionText, 0, 0);
}

export function renderQuestResult(config: ResolvedConfig) {
  return (
    result: AgentToolResult<unknown>,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme,
    _context: unknown,
  ): Text => {
    logger.debug("quests:tool", "renderResult", {
      expanded: options.expanded,
      isPartial: options.isPartial,
    });
    const details = result.details as Record<string, unknown> | undefined;
    const snapshotQuests = details?.snapshotQuests as Quest[] | undefined;
    const allQuests = (snapshotQuests ?? details?.quests) as Quest[] | undefined;
    const questsToRender = (snapshotQuests ?? details?.displayQuests ?? details?.quests) as
      | Quest[]
      | undefined;

    if (
      !Array.isArray(questsToRender) ||
      questsToRender.length === 0 ||
      !Array.isArray(allQuests)
    ) {
      const textLines = result.content
        .map((c) => (c.type === "text" ? c.text : "[image]"))
        .join("\n")
        .split("\n")
        .map((line) => theme.fg("text", line));
      return new Text(collapseLines(textLines, options.expanded, theme), 0, 0);
    }

    const quests = allQuests;
    const renderedIds = new Set(questsToRender.map((q) => q.id));
    const parents = quests.filter((q) => !(q as Quest & { parentId?: string }).parentId);
    const lines: string[] = [];

    function getSteps(parentId: string) {
      return quests.filter((q) => (q as Quest & { parentId?: string }).parentId === parentId);
    }

    function willRenderLater(idx: number): boolean {
      for (let j = idx + 1; j < parents.length; j++) {
        const p = parents[j];
        if (renderedIds.has(p.id)) return true;

        const steps = getSteps(p.id).filter((step) => renderedIds.has(step.id));
        if (steps.length > 0) return true;
      }

      return false;
    }

    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i];
      const parentIncluded = renderedIds.has(parent.id);
      const includedSteps = getSteps(parent.id).filter((step) => renderedIds.has(step.id));

      if (!parentIncluded && includedSteps.length === 0) continue;

      if (parentIncluded) {
        lines.push(formatQuestRow(theme, parent, config.ids.length, i + 1));
        if (includedSteps.length > 0) lines.push(formatStepSpacerLine(theme, config.ids.length));
      }

      for (const step of includedSteps) {
        lines.push(formatQuestRow(theme, step, config.ids.length));
      }

      if (includedSteps.length > 0 && willRenderLater(i)) {
        lines.push("");
      }
    }

    return new Text(collapseLines(lines, options.expanded, theme), 0, 0);
  };
}
