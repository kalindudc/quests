import { readFileSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedConfig } from "../config.js";
import { logger } from "../logger.js";
import type { QuestAction, QuestLog } from "../quest/dataplane.js";
import { QUEST_ACTIONS } from "../quest/types.js";
import { invalidateQuestListWidget, QuestListWidget } from "../renderers/commands.js";
import { CHANGELOG_PATH, getVersion } from "../version.js";
import { reverseChangelog } from "./changelog.js";
import { type ParsedArgs, parseQuestArgs } from "./parse-args.js";

type MutatingCommand = Extract<
  ParsedArgs,
  {
    action:
      | typeof QUEST_ACTIONS.add
      | typeof QUEST_ACTIONS.split
      | typeof QUEST_ACTIONS.toggle
      | typeof QUEST_ACTIONS.update
      | typeof QUEST_ACTIONS.delete
      | typeof QUEST_ACTIONS.clear
      | typeof QUEST_ACTIONS.reorder
      | typeof QUEST_ACTIONS.reparent
      | typeof QUEST_ACTIONS.undo
      | typeof QUEST_ACTIONS.redo;
  }
>["action"];

const commandActionBuilders: {
  [K in MutatingCommand]: (parsed: Extract<ParsedArgs, { action: K }>) => QuestAction;
} = {
  [QUEST_ACTIONS.add]: (p) => ({
    type: QUEST_ACTIONS.add,
    descriptions: p.descriptions,
  }),
  [QUEST_ACTIONS.split]: (p) => ({
    type: QUEST_ACTIONS.split,
    id: p.id,
    descriptions: p.descriptions,
  }),
  [QUEST_ACTIONS.toggle]: (p) => ({ type: QUEST_ACTIONS.toggle, ids: p.ids }),
  [QUEST_ACTIONS.update]: (p) => ({
    type: QUEST_ACTIONS.update,
    id: p.id,
    description: p.description,
  }),
  [QUEST_ACTIONS.delete]: (p) => ({ type: QUEST_ACTIONS.delete, ids: p.ids }),
  [QUEST_ACTIONS.clear]: (p) => ({ type: QUEST_ACTIONS.clear, all: p.all }),
  [QUEST_ACTIONS.reorder]: (p) => ({
    type: QUEST_ACTIONS.reorder,
    id: p.id,
    targetId: p.targetId,
  }),
  [QUEST_ACTIONS.reparent]: (p) => ({
    type: QUEST_ACTIONS.reparent,
    id: p.id,
    parentId: p.parentId,
  }),
  [QUEST_ACTIONS.undo]: () => ({ type: QUEST_ACTIONS.undo }),
  [QUEST_ACTIONS.redo]: () => ({ type: QUEST_ACTIONS.redo }),
};

export function openQuestList(
  _pi: ExtensionAPI,
  questLog: QuestLog,
  config: ResolvedConfig,
  ctx: ExtensionContext,
): Promise<void> {
  return ctx.ui.custom(
    (_, theme, __, done) => new QuestListWidget(questLog, theme, () => done(undefined), config),
  );
}

export function createQuestsHandler(
  pi: ExtensionAPI,
  questLog: QuestLog,
  config: ResolvedConfig,
  onMutate?: (ctx: ExtensionCommandContext) => void,
) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    logger.debug("quests:cmd", "handler", { args, hasUI: ctx.hasUI });

    const parsed = parseQuestArgs(args, config.ids.length);
    if ("error" in parsed) {
      logger.debug("quests:cmd", "handler-error", { error: parsed.error });
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    switch (parsed.action) {
      case "version": {
        const version = getVersion();
        logger.debug("quests:cmd", "version", { version });
        ctx.ui.notify(`pi-quests v${version}`, "info");
        return;
      }
      case "changelog": {
        logger.debug("quests:cmd", "changelog", { changelogPath: CHANGELOG_PATH });

        try {
          const content = readFileSync(CHANGELOG_PATH, "utf-8");
          logger.debug("quests:cmd", "changelog-read", { contentLength: content.length });

          const reversedContent = reverseChangelog(content);
          logger.debug("quests:cmd", "changelog-reversed");

          pi.sendMessage({
            customType: "quest-changelog",
            content: "",
            display: true,
            details: { content: reversedContent },
          });

          logger.debug("quests:cmd", "changelog-sent");
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          logger.debug("quests:cmd", "changelog-error", { error: errorMessage });
          ctx.ui.notify(`Failed to read changelog: ${errorMessage}`, "error");
        }
        return;
      }
      case QUEST_ACTIONS.list: {
        if (!ctx.hasUI) {
          logger.debug("quests:cmd", "list-no-ui");
          ctx.ui.notify("Interactive mode required", "error");
          return;
        }

        logger.debug("quests:cmd", "list-open-widget", { count: questLog.getAll().length });
        await openQuestList(pi, questLog, config, ctx);

        logger.debug("quests:cmd", "list-widget-closed");
        return;
      }
      case QUEST_ACTIONS.add:
      case QUEST_ACTIONS.split:
      case QUEST_ACTIONS.toggle:
      case QUEST_ACTIONS.update:
      case QUEST_ACTIONS.delete:
      case QUEST_ACTIONS.clear:
      case QUEST_ACTIONS.reorder:
      case QUEST_ACTIONS.reparent:
      case QUEST_ACTIONS.undo:
      case QUEST_ACTIONS.redo: {
        const builder = commandActionBuilders[parsed.action];
        const action = builder(parsed as never);
        const result = questLog.execute(action);

        logger.debug("quests:cmd", parsed.action, { success: result.success });
        invalidateQuestListWidget();
        onMutate?.(ctx);
        ctx.ui.notify(result.message, result.success ? "info" : "error");
        return;
      }
      case "help": {
        logger.debug("quests:cmd", "help");

        const lines = ["Available /quests subcommands:"];
        lines.push("  add <description>           - Add a new top-level quest");
        lines.push("  add-step <id> <description> - Split a quest into a step");
        lines.push("  list               - List all quests");
        lines.push("  toggle <id> [moreIds...] - Toggle one or more quests");
        lines.push("  delete <id> [moreIds...] - Delete one or more quests");
        lines.push("  update <id> <desc> - Update a quest description");
        lines.push("  reparent <id> [parentId] - Reparent a quest/step (omit parentId to promote)");
        lines.push("  reorder <id> <targetId> - Reorder a quest before the target quest");
        lines.push("  undo               - Undo the last quest change");
        lines.push("  redo               - Redo the last undone action");
        lines.push("  clear [all]        - Clear completed quests, or optionally all quests");
        lines.push("  version            - Show version");
        lines.push("  changelog          - Show changelog");
        lines.push("  h, help            - Show this help message");

        ctx.ui.notify(lines.join("\n"), "info");
        logger.debug("quests:cmd", "help-complete");
        return;
      }
    }
  };
}
