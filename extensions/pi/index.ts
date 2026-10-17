import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { QUEST_PROMPT_GATE } from "../../src/prompts.js";
import { InvalidQuestLogStateError, QuestLog } from "../../src/quest/dataplane.js";
import { shouldStepAside } from "./bb-bridge.js";
import { createQuestsHandler, openQuestList } from "./commands/handler.js";
import { DEFAULT_CONFIG, getConfig, type ResolvedConfig } from "./config.js";
import { logger } from "./logger.js";
import { questChangelogRenderer } from "./renderers/changelog.js";
import { QuestStatusWidget } from "./renderers/status.js";
import { reconstructFromSession } from "./session.js";
import { getQuestSkillDocument } from "./skill.js";
import { registerQuestTool } from "./tools/handler.js";
import { QuestUsageTracker } from "./tracker.js";

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

const UNREADABLE_QUESTS_NOTICE =
  "This session's quests were saved by an older pi-quests and could not be restored, so the quest log starts empty.";

export default function (pi: ExtensionAPI): void {
  if (shouldStepAside("quest")) {
    logger.debug("quests:bb", "step-aside", { toolsFile: process.env.PI_BB_TOOLS_FILE });
    return;
  }

  let questLog = new QuestLog(DEFAULT_CONFIG, {
    skillDocument: getQuestSkillDocument(),
    debug: logger.debug,
  });
  let tracker = new QuestUsageTracker();
  let config: ResolvedConfig = DEFAULT_CONFIG;
  let statusWidget = new QuestStatusWidget(
    DEFAULT_CONFIG.display.icon,
    DEFAULT_CONFIG.display.showStatus,
  );
  let unreadableNoticeShown = false;

  // pi-quests 0.1 to 0.3 saved numeric ids, which the engine rejects. Such a session starts with an
  // empty log rather than losing its quest tool and /quests command.
  const restoreFromSession = (ctx: ExtensionContext): void => {
    try {
      reconstructFromSession(questLog, ctx);
    } catch (error) {
      if (!(error instanceof InvalidQuestLogStateError)) throw error;
      logger.debug("quests:state", "reconstruct-unreadable", { error: error.message });
      questLog.restore(new QuestLog().toJSON());
      if (!unreadableNoticeShown) {
        unreadableNoticeShown = true;
        ctx.ui.notify(UNREADABLE_QUESTS_NOTICE, "warning");
      }
    }
  };

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
    questLog = new QuestLog(config, {
      skillDocument: getQuestSkillDocument(),
      debug: logger.debug,
    });
    tracker = new QuestUsageTracker();
    statusWidget = new QuestStatusWidget(config.display.icon, config.display.showStatus);
    unreadableNoticeShown = false;
    restoreFromSession(ctx);
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
    restoreFromSession(ctx);
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
        systemPrompt: `# Quest Management\n${QUEST_PROMPT_GATE}\n\n${event.systemPrompt}\n\n## Quest Management\n${NO_QUESTS_REMINDER}`,
      };

    return {
      systemPrompt: `# Quest Management\n${QUEST_PROMPT_GATE}\n\n${event.systemPrompt}`,
    };
  });

  // Register custom message renderers
  pi.registerMessageRenderer("quest-changelog", questChangelogRenderer);
}
