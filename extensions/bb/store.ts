import type { BbPluginApi, JsonValue, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { formatQuestNote, formatUserChanges } from "../../src/prompts.js";
import { type QuestAction, QuestLog, type QuestLogState } from "../../src/quest/dataplane.js";
import { DEFAULT_CONFIG } from "../../src/quest/defaults.js";
import { formatToolResult } from "../../src/quest/formatters.js";
import { type QuestProgress, questProgress } from "../../src/quest/progress.js";
import { QUEST_ACTIONS, type Quest, type Step } from "../../src/quest/types.js";
import { questTag } from "./shared.js";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type ForkOrigin = Pick<ThreadResponse, "originKind" | "originPluginId" | "sourceThreadId">;

// A fixed namespace, not the plugin id, so other plugins can read progress and a package
// rename keeps every thread's quests.
export const QUESTS_METADATA_NAMESPACE = "quests";

export const METADATA_LIMIT_BYTES = 256 * 1024;
const PENDING_NOTE_LIMIT = 50;
const EARLIER_CHANGES = /^and (\d+) earlier changes?$/;
const READ_ONLY_ACTIONS: ReadonlySet<QuestAction["type"]> = new Set([
  QUEST_ACTIONS.list,
  QUEST_ACTIONS.rules,
  QUEST_ACTIONS.skill,
]);

export type QuestView = {
  quests: (Quest | Step)[];
  progress: QuestProgress;
  /** When the agent last changed the log; null until it does. */
  agentChangedAt: number | null;
  /** Panel changes the agent has not seen yet. */
  unseenChanges: number;
};
export type QuestMutation = Exclude<QuestAction, { type: "list" | "rules" | "skill" }>;
/** `notedAt` is when the agent last got a note that its log had gone stale. */
export type QuestTimes = { agentChangedAt: number | null; notedAt: number | null };
export type QuestsMetadata = QuestTimes & {
  progress: QuestProgress;
  log: QuestLogState;
  pendingUserChanges: string[];
};

export interface QuestStore {
  getLog(threadId: string): Promise<QuestView>;
  runTool(threadId: string, action: QuestAction): Promise<{ text: string; isError: boolean }>;
  mutate(threadId: string, action: QuestMutation): Promise<{ message: string; view: QuestView }>;
  copyFork(thread: ThreadResponse): Promise<void>;
  /**
   * Hands `send` the note for a new request, then records it: the user's unseen changes, and the
   * log's state when it has not changed since `previousRequestAt`. Sends nothing when neither
   * applies, and records nothing when `send` throws.
   */
  deliverNote(
    threadId: string,
    previousRequestAt: number | null,
    send: (text: string) => Promise<void>,
  ): Promise<boolean>;
}

type LoadedQuests = QuestTimes & {
  log: QuestLog;
  saved: QuestLogState;
  pendingUserChanges: string[];
};

const NO_TIMES: QuestTimes = { agentChangedAt: null, notedAt: null };

export function createQuestStore(bb: BbPluginApi, skillDocument: string): QuestStore {
  const withThreadLock = createThreadLocks();
  const loaded = (
    state: unknown,
    pendingUserChanges: string[],
    times: QuestTimes,
  ): LoadedQuests => {
    const log = QuestLog.fromJSON(state, DEFAULT_CONFIG, { skillDocument });
    return { log, saved: log.toJSON(), pendingUserChanges, ...times };
  };

  async function read(threadId: string): Promise<LoadedQuests | null> {
    const metadata = await bb.sdk.threads.getPluginMetadata({
      threadId,
      pluginId: QUESTS_METADATA_NAMESPACE,
    });
    const { log, pendingUserChanges, progress, agentChangedAt, notedAt } = metadata;
    if (log === undefined && pendingUserChanges === undefined && progress === undefined) {
      return null;
    }
    try {
      if (!isProgress(progress)) throw new Error("progress is malformed");
      if (!isStringArray(pendingUserChanges)) throw new Error("pendingUserChanges is malformed");
      if (!isOptionalTime(agentChangedAt)) throw new Error("agentChangedAt is malformed");
      if (!isOptionalTime(notedAt)) throw new Error("notedAt is malformed");
      return loaded(log, pendingUserChanges, {
        agentChangedAt: agentChangedAt ?? null,
        notedAt: notedAt ?? null,
      });
    } catch (error) {
      throw new Error(
        `Saved quests for thread ${threadId} are invalid and were left unchanged: ${messageOf(error)}`,
      );
    }
  }

  async function write(
    threadId: string,
    log: QuestLogState,
    pendingUserChanges: readonly string[],
    times: QuestTimes,
  ): Promise<void> {
    const metadata = fitQuestsMetadata(log, pendingUserChanges, times);
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      pluginId: QUESTS_METADATA_NAMESPACE,
      set: JSON.parse(JSON.stringify(metadata)) as Record<string, JsonValue>,
    });
    bb.rpc.experimental_invalidate([questTag(threadId)]);
  }

  /*
   * Forks do not inherit metadata, so an eligible fork copies its source's log the first time
   * any path touches it: the thread.created event or, if the plugin missed that event, the first
   * read or tool call. Writing the copy, even an empty one, keeps later source changes out.
   */
  async function load(threadId: string, thread?: ForkOrigin): Promise<LoadedQuests> {
    const stored = await read(threadId);
    if (stored) return stored;
    const target = thread ?? (await bb.sdk.threads.get({ threadId }));
    const empty = new QuestLog().toJSON();
    if (!isCopyableFork(target)) return loaded(empty, [], NO_TIMES);
    const source = await read(target.sourceThreadId);
    const copy = source?.saved ?? empty;
    const times = { agentChangedAt: source?.agentChangedAt ?? null, notedAt: null };
    await write(threadId, copy, [], times);
    return loaded(copy, [], times);
  }

  return {
    getLog: (threadId) => withThreadLock(threadId, async () => viewOf(await load(threadId))),

    runTool: (threadId, action) =>
      withThreadLock(threadId, async () => {
        const { log, saved, pendingUserChanges, agentChangedAt, notedAt } = await load(threadId);
        const result = log.execute(action);
        const changed = result.success && !READ_ONLY_ACTIONS.has(action.type);
        if (changed || pendingUserChanges.length > 0) {
          await write(threadId, changed ? log.toJSON() : saved, [], {
            agentChangedAt: changed ? Date.now() : agentChangedAt,
            notedAt,
          });
        }
        return {
          text: withUserChanges(
            pendingUserChanges,
            formatToolResult(action.type, result, log.getAll()),
          ),
          isError: !result.success,
        };
      }),

    mutate: (threadId, action) =>
      withThreadLock(threadId, async () => {
        const current = await load(threadId);
        const result = current.log.execute(action);
        if (!result.success) throw new Error(result.message);
        const pendingUserChanges = addUserChange(current.pendingUserChanges, result.message);
        await write(threadId, current.log.toJSON(), pendingUserChanges, timesOf(current));
        return { message: result.message, view: viewOf({ ...current, pendingUserChanges }) };
      }),

    copyFork: async (thread) => {
      if (!isCopyableFork(thread)) return;
      await withThreadLock(thread.id, () => load(thread.id, thread));
    },

    deliverNote: (threadId, previousRequestAt, send) =>
      withThreadLock(threadId, async () => {
        const current = await load(threadId);
        const quests = current.log.getAll();
        const stale = isStale(current, quests, previousRequestAt);
        if (!stale && current.pendingUserChanges.length === 0) return false;
        await send(formatQuestNote(quests, { stale, userChanges: current.pendingUserChanges }));
        await write(threadId, current.saved, [], {
          ...timesOf(current),
          notedAt: stale ? Date.now() : current.notedAt,
        });
        return true;
      }),
  };
}

/*
 * bb refuses a namespace over 256 KiB. Undo and redo history and the pending notes give way first:
 * the oldest entry of the longer stack goes, as it is the furthest from use, then the oldest notes
 * fold into the count line. Only quests that alone exceed the limit fail the write.
 */
export function fitQuestsMetadata(
  log: QuestLogState,
  pendingUserChanges: readonly string[],
  { agentChangedAt, notedAt }: QuestTimes = NO_TIMES,
): QuestsMetadata {
  const times = { agentChangedAt, notedAt };
  const progress = progressOfState(log);
  const history = [...log.history];
  const redoStack = [...log.redoStack];
  let pending = [...pendingUserChanges];
  const historySizes = history.map(jsonBytes);
  const redoSizes = redoStack.map(jsonBytes);
  const emptyBytes = jsonBytes({
    progress,
    log: { ...log, history: [], redoStack: [] },
    pendingUserChanges: [],
    ...times,
  });
  const bytes = () =>
    emptyBytes + entryBytes(historySizes) + entryBytes(redoSizes) + jsonBytes(pending) - 2;

  while (bytes() > METADATA_LIMIT_BYTES) {
    if (history.length > 0 && history.length >= redoStack.length) {
      history.shift();
      historySizes.shift();
    } else if (redoStack.length > 0) {
      redoStack.shift();
      redoSizes.shift();
    } else {
      const { notes, earlier } = splitUserChanges(pending);
      if (notes.length === 0) {
        throw new Error(
          `Could not save quests: this thread's quests take ${Math.ceil(bytes() / 1024)} KiB, over bb's 256 KiB limit for thread metadata even without undo history. Nothing was changed.`,
        );
      }
      pending = joinUserChanges(notes.slice(1), earlier + 1);
    }
  }
  return { progress, log: { ...log, history, redoStack }, pendingUserChanges: pending, ...times };
}

/*
 * Stale: quests are open and the agent has not changed them since the user's previous request,
 * and no note has gone out since the agent's last change. A log the agent never changed has no
 * baseline, so it is never stale.
 */
function isStale(
  { agentChangedAt, notedAt }: QuestTimes,
  quests: readonly (Quest | Step)[],
  previousRequestAt: number | null,
): boolean {
  if (agentChangedAt === null || previousRequestAt === null) return false;
  if (!quests.some((quest) => !quest.done)) return false;
  return agentChangedAt < previousRequestAt && (notedAt === null || notedAt < agentChangedAt);
}

/** Appends a panel change for the agent, folding all but the newest 50 into a count line. */
function addUserChange(pending: readonly string[], note: string): string[] {
  const { notes, earlier } = splitUserChanges(pending);
  const kept = [...notes, note];
  const folded = Math.max(kept.length - PENDING_NOTE_LIMIT, 0);
  return joinUserChanges(kept.slice(folded), earlier + folded);
}

function splitUserChanges(pending: readonly string[]): { notes: string[]; earlier: number } {
  const count = EARLIER_CHANGES.exec(pending.at(-1) ?? "");
  return count
    ? { notes: pending.slice(0, -1), earlier: Number(count[1]) }
    : { notes: [...pending], earlier: 0 };
}

function joinUserChanges(notes: readonly string[], earlier: number): string[] {
  if (earlier === 0) return [...notes];
  return [...notes, `and ${earlier} earlier change${earlier === 1 ? "" : "s"}`];
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// What a JSON array's entries add to an empty array: their own bytes plus the commas between them.
function entryBytes(sizes: readonly number[]): number {
  return sizes.reduce((total, size) => total + size, 0) + Math.max(sizes.length - 1, 0);
}

// Every step has a parent quest (restore checks it), so this counts exactly what getAll() returns.
function progressOfState(log: QuestLogState): QuestProgress {
  return questProgress([...log.quests, ...log.steps]);
}

function timesOf({ agentChangedAt, notedAt }: QuestTimes): QuestTimes {
  return { agentChangedAt, notedAt };
}

function viewOf({ log, agentChangedAt, pendingUserChanges }: LoadedQuests): QuestView {
  const quests = log.getAll();
  const { notes, earlier } = splitUserChanges(pendingUserChanges);
  return {
    quests,
    progress: questProgress(quests),
    agentChangedAt,
    unseenChanges: notes.length + earlier,
  };
}

function withUserChanges(changes: string[], message: string): string {
  return changes.length === 0 ? message : `${formatUserChanges(changes)}\n\n${message}`;
}

function isCopyableFork<T extends ForkOrigin>(thread: T): thread is T & { sourceThreadId: string } {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId !== "side-chat" &&
    thread.sourceThreadId !== null
  );
}

function isOptionalTime(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (Number.isInteger(value) && Number(value) >= 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProgress(value: unknown): value is QuestProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { done, total, current } = value as Record<string, unknown>;
  return (
    Number.isInteger(done) &&
    Number.isInteger(total) &&
    (current === null || typeof current === "string")
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createThreadLocks() {
  const tails = new Map<string, Promise<void>>();
  return async function withThreadLock<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const result = (tails.get(threadId) ?? Promise.resolve()).then(task);
    const tail = result.then(
      () => {},
      () => {},
    );
    tails.set(threadId, tail);
    try {
      return await result;
    } finally {
      if (tails.get(threadId) === tail) tails.delete(threadId);
    }
  };
}
