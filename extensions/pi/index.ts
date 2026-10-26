import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { formatQuestNote } from "../../src/prompts.js";
import { InvalidQuestLogStateError, QuestLog } from "../../src/quest/dataplane.js";
import type { Quest } from "../../src/quest/types.js";
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
const UNREADABLE_QUESTS_NOTICE =
  "This session's quests were saved by an older pi-quests and could not be restored, so the quest log starts empty.";

export const QUEST_NOTE_TYPE = "quest-note";

/*
 * A request is stale when quests are open and the log is unchanged since the previous request.
 * The note goes out once per stale stretch: after it, only a change to the log rearms it.
 */
function createStalenessCheck() {
  let previous: string | undefined;
  let noted = false;
  return {
    reset(): void {
      previous = undefined;
      noted = false;
    },
    check(quests: readonly Quest[]): boolean {
      const snapshot = JSON.stringify(
        quests.map(({ id, description, done }) => [id, description, done]),
      );
      const unchanged = snapshot === previous;
      previous = snapshot;
      if (!unchanged) noted = false;
      if (!unchanged || noted || !quests.some((quest) => !quest.done)) return false;
      noted = true;
      return true;
    },
  };
}

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
  const staleness = createStalenessCheck();

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
    staleness.reset();
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
    staleness.reset();
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

  // The tool's guidelines already carry the rules, so the system prompt stays byte-identical and
  // cached; a stale log gets one note on the user's prompt instead of an extra model call.
  pi.on("before_agent_start", async () => {
    const quests = questLog.getAll();
    if (!staleness.check(quests)) return undefined;
    return {
      message: {
        customType: QUEST_NOTE_TYPE,
        content: formatQuestNote(quests, { stale: true, userChanges: [] }),
        display: false,
      },
    };
  });

  // Register custom message renderers
  pi.registerMessageRenderer("quest-changelog", questChangelogRenderer);
}
