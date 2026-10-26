import { type BbPluginApi, defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { QUEST_INSTRUCTIONS } from "../../src/prompts.js";
import type { QuestAction } from "../../src/quest/dataplane.js";
import { DEFAULT_CONFIG } from "../../src/quest/defaults.js";
import { QUEST_ACTION_VALUES, QUEST_ACTIONS } from "../../src/quest/types.js";
import { refuseNoteStartingTurn, steerer, watchRequests } from "./requests.js";
import { RPC_TAGS, STEER_PROVIDERS } from "./shared.js";
import { createQuestStore } from "./store.js";

// bb loads src/skills/quest-management/SKILL.md as a plugin skill; the server reads no files.
export const QUEST_SKILL_POINTER =
  "The complete quest guide is the quest-management skill. Read it for actions, workflows, and rules.";

const QUEST_TOOL_INSTRUCTIONS = QUEST_INSTRUCTIONS.map((line) => `- ${line}`).join("\n");

const ID_LENGTH = DEFAULT_CONFIG.ids.length;
const questId = z.string().regex(new RegExp(`^[0-9a-f]{${ID_LENGTH}}$`));
const questIds = z.array(questId).min(1);
const descriptions = z.array(z.string());

// Mirrors src/tools/params.ts, which cannot load here because it imports pi-ai at runtime.
const questToolParameters = z.object({
  action: z.enum(QUEST_ACTION_VALUES).describe("The quest action to perform"),
  descriptions: descriptions
    .optional()
    .describe("Array of quest descriptions (required for add action)"),
  description: z.string().optional().describe("New description (required for update action)"),
  id: questId
    .optional()
    .describe(
      `Quest ID (required for update, reorder, and reparent actions. For toggle and delete, provide either id or ids. ALWAYS use the ${ID_LENGTH}-digit hex ID shown in brackets, never the positional number.`,
    ),
  ids: questIds
    .optional()
    .describe(
      `Quest IDs for batch toggle or delete actions. Use this when operating on more than one ${ID_LENGTH}-digit hex quest ID at once.`,
    ),
  targetId: questId
    .optional()
    .describe(
      "Target quest ID for reorder action. The quest will be moved to just before the target quest.",
    ),
  parentId: questId
    .optional()
    .describe("Parent quest ID for reparent action. Omit to promote to top-level."),
  all: z
    .boolean()
    .optional()
    .describe("Clear all quests when true (defaults to clearing only completed quests)"),
});

type QuestToolParameters = z.output<typeof questToolParameters>;

const questMutation = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal(QUEST_ACTIONS.add), descriptions: descriptions.optional() }),
  z.strictObject({
    type: z.literal(QUEST_ACTIONS.split),
    id: questId.optional(),
    descriptions: descriptions.optional(),
  }),
  z.strictObject({
    type: z.literal(QUEST_ACTIONS.add_step),
    id: questId.optional(),
    descriptions: descriptions.optional(),
  }),
  z.strictObject({
    type: z.literal(QUEST_ACTIONS.toggle),
    id: questId.optional(),
    ids: questIds.optional(),
  }),
  z.strictObject({
    type: z.literal(QUEST_ACTIONS.update),
    id: questId.optional(),
    description: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal(QUEST_ACTIONS.delete),
    id: questId.optional(),
    ids: questIds.optional(),
  }),
  z.strictObject({ type: z.literal(QUEST_ACTIONS.clear), all: z.boolean().optional() }),
  z.strictObject({
    type: z.literal(QUEST_ACTIONS.reorder),
    id: questId.optional(),
    targetId: questId.optional(),
  }),
  z.strictObject({
    type: z.literal(QUEST_ACTIONS.reparent),
    id: questId.optional(),
    parentId: questId.optional(),
  }),
  z.strictObject({ type: z.literal(QUEST_ACTIONS.undo) }),
  z.strictObject({ type: z.literal(QUEST_ACTIONS.redo) }),
]);

const questView = z.object({
  quests: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      done: z.boolean(),
      createdAt: z.number(),
      parentId: z.string().optional(),
    }),
  ),
  progress: z.object({
    done: z.number().int(),
    total: z.number().int(),
    current: z.string().nullable(),
  }),
  agentChangedAt: z.number().int().nullable(),
  unseenChanges: z.number().int(),
});

const threadId = z.string().min(1);

export const rpcContract = defineRpcContract({
  getLog: {
    input: z.strictObject({ threadId }),
    output: questView,
    ...RPC_TAGS.getLog,
  },
  mutate: {
    input: z.strictObject({ threadId, action: questMutation }),
    output: z.object({ message: z.string(), view: questView }),
    ...RPC_TAGS.mutate,
  },
  /** Steers the user's unseen panel changes into the running turn; false when nothing was sent. */
  tell: {
    input: z.strictObject({ threadId }),
    output: z.object({ sent: z.boolean() }),
    ...RPC_TAGS.tell,
  },
});

function toQuestAction(params: QuestToolParameters): QuestAction {
  switch (params.action) {
    case QUEST_ACTIONS.add:
      return { type: params.action, descriptions: params.descriptions };
    case QUEST_ACTIONS.split:
    case QUEST_ACTIONS.add_step:
      return { type: params.action, id: params.id, descriptions: params.descriptions };
    case QUEST_ACTIONS.toggle:
    case QUEST_ACTIONS.delete:
      return { type: params.action, id: params.id, ids: params.ids };
    case QUEST_ACTIONS.update:
      return { type: params.action, id: params.id, description: params.description };
    case QUEST_ACTIONS.clear:
      return { type: params.action, all: params.all };
    case QUEST_ACTIONS.reorder:
      return { type: params.action, id: params.id, targetId: params.targetId };
    case QUEST_ACTIONS.reparent:
      return { type: params.action, id: params.id, parentId: params.parentId };
    case QUEST_ACTIONS.list:
    case QUEST_ACTIONS.rules:
    case QUEST_ACTIONS.skill:
    case QUEST_ACTIONS.undo:
    case QUEST_ACTIONS.redo:
      return { type: params.action };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const store = createQuestStore(bb, QUEST_SKILL_POINTER);

  bb.rpc.register(rpcContract, {
    getLog: ({ threadId }) => store.getLog(threadId),
    mutate: ({ threadId, action }) => store.mutate(threadId, action),
    tell: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.status !== "active" || !STEER_PROVIDERS.has(thread.providerId)) {
        return { sent: false };
      }
      return { sent: await store.deliverNote(threadId, null, steerer(bb, threadId)) };
    },
  });
  watchRequests(bb, store);
  bb.experimental_hooks.on("message.dispatch", refuseNoteStartingTurn);

  bb.agents.registerTool({
    name: "quest",
    description:
      "Manage this thread's quest log and retrieve the complete quest system documentation. " +
      "When you need to understand quests, steps, rules, or best practices, use action: 'skill' or action: 'rules'.",
    instructions: QUEST_TOOL_INSTRUCTIONS,
    parameters: questToolParameters,
    async execute(params, { threadId }) {
      try {
        const { text, isError } = await store.runTool(threadId, toQuestAction(params));
        return isError ? { content: [{ type: "text", text }], isError: true } : text;
      } catch (error) {
        bb.log.warn(`quest tool failed in thread ${threadId}: ${messageOf(error)}`);
        return { content: [{ type: "text", text: `Error: ${messageOf(error)}` }], isError: true };
      }
    },
  });

  bb.events.on("thread.created", ({ thread }) =>
    store.copyFork(thread).catch((error: unknown) => {
      bb.log.warn(`Could not copy quests into fork ${thread.id}: ${messageOf(error)}`);
    }),
  );
}
