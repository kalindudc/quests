import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { QuestLog, QuestLogState } from "../../src/quest/dataplane.js";
import type { Quest, Step } from "../../src/quest/types.js";
import { logger } from "./logger.js";

/*
 * pi keeps no quest state of its own: the latest quest tool result on the session branch carries
 * the full quest list in its details. Undo and redo history do not survive reconstruction.
 */
export function reconstructFromSession(log: QuestLog, ctx: ExtensionContext): void {
  let lastState: Record<string, unknown> | undefined;
  let toolResults = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (
      entry.type === "message" &&
      "message" in entry &&
      entry.message.role === "toolResult" &&
      entry.message.toolName === "quest"
    ) {
      toolResults++;
      lastState = entry.message.details;
    }
  }

  const records = lastState && Array.isArray(lastState.quests) ? (lastState.quests as Quest[]) : [];
  const quests = records.filter((q) => !("parentId" in q && q.parentId));
  const steps = records.filter((q) => "parentId" in q && q.parentId) as Step[];
  const state: QuestLogState = {
    version: 1,
    quests,
    steps,
    usedIds: [...quests, ...steps].map((q) => q.id),
    history: [],
    redoStack: [],
  };

  log.restore(state);
  logger.debug("quests:state", lastState ? "reconstruct" : "reconstruct-empty", {
    toolResults,
    questCount: records.length,
  });
}

export function makeToolResult(
  text: string,
  questLog: QuestLog,
  displayQuests?: Quest[],
  snapshotQuests?: Quest[],
): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    details: {
      quests: questLog.getAll(),
      usedIds: questLog.getUsedIds(),
      displayQuests,
      snapshotQuests,
    },
  };
}
