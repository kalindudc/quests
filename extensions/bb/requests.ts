import type {
  BbPluginApi,
  MessageDispatchHookContext,
  MessageDispatchHookDecision,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { QUEST_NOTE_PREFIX } from "../../src/prompts.js";
import { STEER_PROVIDERS } from "./shared.js";
import type { QuestStore } from "./store.js";

type PromptInput = MessageDispatchHookContext["input"]["blocks"][number];
type EventRow = { seq: number; createdAt: number; type?: string; data: unknown };
type Watched = {
  requestSeq: number;
  previousRequestAt: number | null;
  /** The newest item event already read. */
  lastSeq: number;
  /** Tool items that have started and not completed. */
  running: Set<string>;
  checking: boolean;
  /** A signal arrived during a check, so look again once it ends. */
  again: boolean;
};

// Enough requests back to step over notes, minion reports and other plugins' messages.
const REQUEST_LOOKBACK = "20";
// bb serves at most 100 events per page.
const ITEM_PAGE = 100;
const ITEM_PAGES = 10;
const WORK_ITEMS: ReadonlySet<string> = new Set([
  "commandExecution",
  "fileChange",
  "fileRead",
  "imageView",
  "toolCall",
  "webSearch",
]);

const requestSchema = z.object({
  initiator: z.string(),
  input: z.array(z.unknown()),
});
const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  visibility: z.string().optional(),
});
const itemSchema = z.object({
  item: z.object({ type: z.string(), id: z.string().nullish(), tool: z.string().nullish() }),
});

/** A request a person sent: user-initiated, with text the user can see (not an agent-only note). */
export function isUserRequest(row: EventRow): boolean {
  const parsed = requestSchema.safeParse(row.data);
  if (!parsed.success || parsed.data.initiator !== "user") return false;
  return parsed.data.input.some((part) => {
    const text = textPartSchema.safeParse(part);
    return text.success && text.data.visibility !== "agent-only";
  });
}

export function agentOnly(text: string) {
  return [{ type: "text" as const, text, mentions: [], visibility: "agent-only" as const }];
}

export function isQuestNote(blocks: readonly PromptInput[]): boolean {
  return blocks.some(
    (block) =>
      block.type === "text" &&
      block.visibility === "agent-only" &&
      block.text.startsWith(QUEST_NOTE_PREFIX),
  );
}

/**
 * bb turns a steer to a thread whose turn just ended into a new turn. A note is only worth
 * sending into a turn already running, so the dispatch checkpoint refuses one that would start
 * a turn. It must never throw: a failing hook would fail every message in bb.
 */
export function refuseNoteStartingTurn(context: {
  attempt: string;
  input: { blocks: readonly PromptInput[] };
}): MessageDispatchHookDecision {
  try {
    if (context.attempt === "start-turn" && isQuestNote(context.input.blocks)) {
      return { action: "reject", message: "A quest note only joins a running turn." };
    }
  } catch {
    // An unexpected input shape is never a quest note.
  }
  return { action: "proceed" };
}

/** Steers a note into a running turn; the dispatch hook refuses it if the turn has ended. */
export function steerer(bb: BbPluginApi, threadId: string) {
  return async (text: string): Promise<void> => {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.status !== "active") throw new Error("the thread is no longer running");
    await bb.sdk.threads.send({ threadId, mode: "steer", input: agentOnly(text) });
  };
}

/*
 * When a person's request starts a turn on a thread with open quests or unseen panel changes,
 * the thread is watched. The note goes in while one of the agent's tools is running: a steer
 * lands before the next model call, so it adds no call of its own. A quest call first ends the
 * watch unsent, and so does a turn that ends before a tool was seen running; the next request
 * gets another chance.
 */
export function watchRequests(bb: BbPluginApi, store: QuestStore): void {
  const watched = new Map<string, Watched>();
  // Bumped on every turn boundary, so a read that started before one cannot install a watch.
  const generations = new Map<string, number>();
  const nextGeneration = (threadId: string) => {
    const generation = (generations.get(threadId) ?? 0) + 1;
    generations.set(threadId, generation);
    watched.delete(threadId);
    return generation;
  };
  const warn = (what: string, threadId: string, error: unknown) =>
    bb.log.warn(`${what} for thread ${threadId} failed: ${messageOf(error)}`);

  /** Reads the item events since the last look: "drop" after a quest call, else whether a tool runs. */
  async function scan(threadId: string, entry: Watched): Promise<"drop" | "send" | "wait"> {
    for (let page = 0; page < ITEM_PAGES; page++) {
      const rows: EventRow[] = await bb.sdk.threads.events.list({
        threadId,
        types: ["item/started", "item/completed"],
        afterSeq: String(entry.lastSeq),
        order: "asc",
        limit: String(ITEM_PAGE),
      });
      for (const row of rows) {
        entry.lastSeq = Math.max(entry.lastSeq, row.seq);
        const parsed = itemSchema.safeParse(row.data);
        if (!parsed.success || !WORK_ITEMS.has(parsed.data.item.type)) continue;
        const { id, tool } = parsed.data.item;
        if (row.type === "item/started" && tool?.endsWith("quest")) return "drop";
        if (!id) continue;
        if (row.type === "item/started") entry.running.add(id);
        else entry.running.delete(id);
      }
      if (rows.length < ITEM_PAGE) break;
    }
    return entry.running.size > 0 ? "send" : "wait";
  }

  async function check(threadId: string): Promise<void> {
    const entry = watched.get(threadId);
    if (entry === undefined) return;
    if (entry.checking) {
      entry.again = true;
      return;
    }
    entry.checking = true;
    try {
      do {
        entry.again = false;
        const decision = await scan(threadId, entry);
        if (watched.get(threadId) !== entry) return;
        if (decision === "wait") continue;
        watched.delete(threadId);
        if (decision === "send") {
          await store.deliverNote(threadId, entry.previousRequestAt, steerer(bb, threadId));
        }
        return;
      } while (entry.again);
    } catch (error) {
      warn("Sending the quest note", threadId, error);
    } finally {
      entry.checking = false;
    }
  }

  bb.events.on("thread.active", async ({ thread }) => {
    const generation = nextGeneration(thread.id);
    if (!STEER_PROVIDERS.has(thread.providerId)) return;
    try {
      // Most turns are on threads with nothing open, so the log is checked before the events.
      const view = await store.getLog(thread.id);
      if (view.unseenChanges === 0 && !view.quests.some((quest) => !quest.done)) return;
      const rows: EventRow[] = await bb.sdk.threads.events.list({
        threadId: thread.id,
        types: ["client/turn/requested"],
        order: "desc",
        limit: REQUEST_LOOKBACK,
      });
      const [latest, ...earlier] = rows;
      if (latest === undefined || !isUserRequest(latest)) return;
      if (generations.get(thread.id) !== generation) return;
      watched.set(thread.id, {
        requestSeq: latest.seq,
        previousRequestAt: earlier.find(isUserRequest)?.createdAt ?? null,
        lastSeq: latest.seq,
        running: new Set(),
        checking: false,
        again: false,
      });
      await check(thread.id);
    } catch (error) {
      warn("Reading the request", thread.id, error);
    }
  });

  bb.events.on("experimental_thread.events", ({ thread }) => check(thread.id));

  const turnEnded = ({ thread }: { thread: { id: string } }) => {
    nextGeneration(thread.id);
  };
  bb.events.on("thread.idle", turnEnded);
  bb.events.on("thread.failed", turnEnded);
  const forget = ({ thread }: { thread: { id: string } }) => {
    watched.delete(thread.id);
    generations.delete(thread.id);
  };
  bb.events.on("thread.archived", forget);
  bb.events.on("thread.deleted", forget);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
