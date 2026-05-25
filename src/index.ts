import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { KeyId } from "@mariozechner/pi-tui";
import { createQuestsHandler, openQuestList } from "./commands/handler.js";
import { DEFAULT_CONFIG, getConfig, type ResolvedConfig } from "./config.js";
import { logger } from "./logger.js";
import { QUEST_PROMPT_GATE } from "./prompts.js";
import { QuestLog } from "./quest/dataplane.js";
import { QuestUsageTracker } from "./quest/tracker.js";
import { questChangelogRenderer } from "./renderers/changelog.js";
import { QuestStatusWidget } from "./renderers/status.js";
import { registerQuestTool } from "./tools/handler.js";

/**
 * pi-quests
 *
 * A quest-log extension for pi-coding-agent.
 *
 * Roadmap:
 * - Register tools for agents to add, list, and manage quest items.
 * - Snapshot relevant session state at each quest milestone.
 * - Provide rollback support to restore a previous snapshot.
 */
const NO_QUESTS_REMINDER =
  "No active quests. Use the learn_quests tool to understand how to use quests and use quests to track this task. DO THIS NOW and acknowledge it.";

export default function (pi: ExtensionAPI): void {
  let questLog = new QuestLog();
  let tracker = new QuestUsageTracker();
  let config: ResolvedConfig = DEFAULT_CONFIG;
  let statusWidget = new QuestStatusWidget(
    DEFAULT_CONFIG.display.icon,
    DEFAULT_CONFIG.display.showStatus,
  );

  const shortcutKey = getConfig({ cwd: process.cwd() }).shortcuts?.openQuests ?? "ctrl+shift+l";
  logger.debug("quests:shortcut", "register", { key: shortcutKey });
  pi.registerShortcut(shortcutKey as KeyId, {
    description: "Open quest list",
    handler: async (ctx) => {
      logger.debug("quests:shortcut", "handler", { hasUI: ctx.hasUI });
      if (!ctx.hasUI) {
        logger.debug("quests:shortcut", "no-ui");
        ctx.ui.notify("Interactive mode required", "error");
        return;
      }
      logger.debug("quests:shortcut", "open", { questCount: questLog.getAll().length });
      await openQuestList(pi, questLog, config, ctx);
      logger.debug("quests:shortcut", "closed");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    config = getConfig(ctx);
    questLog = new QuestLog(config);
    tracker = new QuestUsageTracker();
    statusWidget = new QuestStatusWidget(config.display.icon, config.display.showStatus);
    questLog.reconstructFromSession(ctx);
    if (questLog.getAll().length > 0) tracker.markQuestToolUsed();
    statusWidget.update(questLog, ctx.ui, ctx.ui.theme);

    registerQuestTool(pi, questLog, config);

    const questsHandler = createQuestsHandler(pi, questLog, config, (ctx) => {
      statusWidget.update(questLog, ctx.ui, ctx.ui.theme);
    });
    pi.registerCommand("quests", {
      description: "Quest commands: /quests [help] to see usage",
      handler: questsHandler,
    });
  });

  pi.on("session_tree", async (_event, ctx) => {
    questLog.reconstructFromSession(ctx);
    if (questLog.getAll().length > 0) tracker.markQuestToolUsed();
    statusWidget.update(questLog, ctx.ui, ctx.ui.theme);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    tracker.onToolExecution(event.toolName);
    if (event.toolName === "quest") {
      statusWidget.update(questLog, ctx.ui, ctx.ui.theme);
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (questLog.getAll().length === 0)
      return {
        systemPrompt: `${event.systemPrompt}\n\nUse quests to track this task. DO THIS now and acknowledge it.`,
      };

    return {
      systemPrompt: `# Quest Management\n${QUEST_PROMPT_GATE}${event.systemPrompt}\n\n## Quest Management\n${NO_QUESTS_REMINDER}`,
    };
  });

  // Register custom message renderers
  pi.registerMessageRenderer("quest-changelog", questChangelogRenderer);
}
