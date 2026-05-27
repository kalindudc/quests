import type { AgentToolResult, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { ResolvedConfig } from "../config.js";
import { logger } from "../logger.js";
import { QUEST_PROMPT_GATE, QUEST_PROMPT_REMINDER } from "../prompts.js";
import { makeToolResult, type QuestAction, type QuestLog } from "../quest/dataplane.js";
import { QUEST_ACTIONS, type QuestActionType } from "../quest/types.js";

const SPLIT_DISPLAY_ACTIONS = [
  QUEST_ACTIONS.add,
  QUEST_ACTIONS.list,
  QUEST_ACTIONS.split,
  QUEST_ACTIONS.add_step,
  QUEST_ACTIONS.undo,
  QUEST_ACTIONS.redo,
] as const;

import { invalidateQuestListWidget } from "../renderers/commands.js";
import { renderQuestCall, renderQuestResult } from "../renderers/tools.js";
import { createQuestParams, type QuestParamsType } from "./params.js";

type QuestToolParams = Static<QuestParamsType>;

type ToolHandler = (
  questLog: QuestLog,
  params: QuestToolParams,
  toolCallId: string,
) => AgentToolResult<unknown>;

const toolHandlers: Record<QuestActionType, ToolHandler> = {
  [QUEST_ACTIONS.add]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.add,
      descriptions: params.descriptions,
    }),
  [QUEST_ACTIONS.split]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.split,
      id: params.id,
      descriptions: params.descriptions,
    }),
  [QUEST_ACTIONS.add_step]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.add_step,
      id: params.id,
      descriptions: params.descriptions,
    }),
  [QUEST_ACTIONS.list]: (questLog, _params, toolCallId) =>
    runTool(questLog, toolCallId, { type: QUEST_ACTIONS.list }),
  [QUEST_ACTIONS.toggle]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.toggle,
      id: params.id,
      ids: params.ids,
    }),
  [QUEST_ACTIONS.update]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.update,
      id: params.id,
      description: params.description,
    }),
  [QUEST_ACTIONS.delete]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.delete,
      id: params.id,
      ids: params.ids,
    }),
  [QUEST_ACTIONS.clear]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, { type: QUEST_ACTIONS.clear, all: params.all }),
  [QUEST_ACTIONS.reorder]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.reorder,
      id: params.id,
      targetId: params.targetId,
    }),
  [QUEST_ACTIONS.reparent]: (questLog, params, toolCallId) =>
    runTool(questLog, toolCallId, {
      type: QUEST_ACTIONS.reparent,
      id: params.id,
      parentId: params.parentId,
    }),
  [QUEST_ACTIONS.rules]: (questLog, _params, toolCallId) =>
    runTool(questLog, toolCallId, { type: QUEST_ACTIONS.rules }),
  [QUEST_ACTIONS.skill]: (questLog, _params, toolCallId) =>
    runTool(questLog, toolCallId, { type: QUEST_ACTIONS.skill }),
  [QUEST_ACTIONS.undo]: (questLog, _params, toolCallId) =>
    runTool(questLog, toolCallId, { type: QUEST_ACTIONS.undo }),
  [QUEST_ACTIONS.redo]: (questLog, _params, toolCallId) =>
    runTool(questLog, toolCallId, { type: QUEST_ACTIONS.redo }),
};

function runTool(
  questLog: QuestLog,
  toolCallId: string,
  action: QuestAction,
): AgentToolResult<unknown> {
  const result = questLog.execute(action);
  invalidateQuestListWidget();
  logger.debug("quests:tool", "execute-complete", { toolCallId, success: result.success });

  const displayQuests = SPLIT_DISPLAY_ACTIONS.includes(
    action.type as (typeof SPLIT_DISPLAY_ACTIONS)[number],
  )
    ? questLog.getAll()
    : (result.quests ?? (result.quest ? [result.quest] : []));
  const snapshotQuests = action.type === QUEST_ACTIONS.delete ? displayQuests : undefined;

  return makeToolResult(result.message, questLog, displayQuests, snapshotQuests);
}

export async function questToolExecute(
  questLog: QuestLog,
  toolCallId: string,
  params: QuestToolParams,
): Promise<AgentToolResult<unknown>> {
  logger.debug("quests:tool", "execute", {
    toolCallId,
    action: params.action,
    id: params.id,
    ids: params.ids,
  });
  const handler = toolHandlers[params.action as QuestActionType];
  return handler(questLog, params, toolCallId);
}

export function registerQuestTool(
  pi: ExtensionAPI,
  questLog: QuestLog,
  config: ResolvedConfig,
): void {
  logger.debug("quests:tool", "register");
  pi.registerTool({
    name: "quest",
    label: "Quest",
    description:
      "Manage the session quest log and retrieve the complete quest system documentation. " +
      "When you need to understand quests, steps, rules, or best practices, use action: 'skill' or action: 'rules'.",
    promptSnippet:
      "Manage quests and steps, or retrieve quest rules and best practices via skill/rules. " +
      "Use this VERY frequently to track tasks, plans, and progress. ",
    promptGuidelines: [QUEST_PROMPT_GATE, ...QUEST_PROMPT_REMINDER],
    parameters: createQuestParams(config.ids.length),
    execute: (toolCallId, params, _signal, _onUpdate, _ctx) =>
      questToolExecute(questLog, toolCallId, params),
    renderCall: renderQuestCall as unknown as (
      args: object,
      theme: Theme,
      context: unknown,
    ) => ReturnType<typeof renderQuestCall>,
    renderResult: renderQuestResult(config),
  });

  pi.registerTool({
    name: "learn_quests",
    label: "Learn Quests",
    description: "Learn about the quest system and how to use it effectively.",
    promptSnippet: "Use this tool to learn about the quest system and how to use it effectively.",
    promptGuidelines: [
      "Use this tool when on a session to understand how and when to use quests.",
      "ALWAYS run this tool when on a new session before starting any work.",
    ],
    parameters: Type.Object(
      {},
      { description: "No parameters required for learning about quests" },
    ),
    execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) =>
      questToolExecute(questLog, "learn_quests", { action: QUEST_ACTIONS.skill }),
    renderCall: ((_args: object, theme: Theme, context: unknown) =>
      renderQuestCall({ action: QUEST_ACTIONS.skill }, theme, context)) as unknown as (
      args: object,
      theme: Theme,
      context: unknown,
    ) => ReturnType<typeof renderQuestCall>,
    renderResult: renderQuestResult(config),
  });
}
