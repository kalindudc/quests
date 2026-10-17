import type { BbPluginApi, JsonValue, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { type QuestAction, QuestLog, type QuestLogState } from "../../src/quest/dataplane.js";
import { DEFAULT_CONFIG } from "../../src/quest/defaults.js";
import { type QuestProgress, questProgress } from "../../src/quest/progress.js";
import { QUEST_ACTIONS, type Quest, type Step } from "../../src/quest/types.js";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type ForkOrigin = Pick<ThreadResponse, "originKind" | "originPluginId" | "sourceThreadId">;

// A fixed namespace, not the plugin id, so other plugins can read progress and a package
// rename keeps every thread's quests.
export const QUESTS_METADATA_NAMESPACE = "quests";
export const QUESTS_REALTIME_CHANNEL = "quests";
export const USER_CHANGES_PREFIX = "The user changed the quest log:";

export const METADATA_LIMIT_BYTES = 256 * 1024;
const PENDING_NOTE_LIMIT = 50;
const EARLIER_CHANGES = /^and (\d+) earlier changes?$/;
const READ_ONLY_ACTIONS: ReadonlySet<QuestAction["type"]> = new Set([
  QUEST_ACTIONS.list,
  QUEST_ACTIONS.rules,
  QUEST_ACTIONS.skill,
]);

export type QuestView = { quests: (Quest | Step)[]; progress: QuestProgress };
export type QuestMutation = Exclude<QuestAction, { type: "list" | "rules" | "skill" }>;
export type QuestsMetadata = {
  progress: QuestProgress;
  log: QuestLogState;
  pendingUserChanges: string[];
};

export interface QuestStore {
  getLog(threadId: string): Promise<QuestView>;
  runTool(threadId: string, action: QuestAction): Promise<{ text: string; isError: boolean }>;
  mutate(threadId: string, action: QuestMutation): Promise<{ message: string; view: QuestView }>;
  copyFork(thread: ThreadResponse): Promise<void>;
}

type LoadedQuests = { log: QuestLog; saved: QuestLogState; pendingUserChanges: string[] };

export function createQuestStore(bb: BbPluginApi, skillDocument: string): QuestStore {
  const withThreadLock = createThreadLocks();
  const loaded = (state: unknown, pendingUserChanges: string[]): LoadedQuests => {
    const log = QuestLog.fromJSON(state, DEFAULT_CONFIG, { skillDocument });
    return { log, saved: log.toJSON(), pendingUserChanges };
  };

  async function read(threadId: string): Promise<LoadedQuests | null> {
    const metadata = await bb.sdk.threads.getPluginMetadata({
      threadId,
      pluginId: QUESTS_METADATA_NAMESPACE,
    });
    const { log, pendingUserChanges, progress } = metadata;
    if (log === undefined && pendingUserChanges === undefined && progress === undefined) {
      return null;
    }
    try {
      if (!isProgress(progress)) throw new Error("progress is malformed");
      if (!isStringArray(pendingUserChanges)) throw new Error("pendingUserChanges is malformed");
      return loaded(log, pendingUserChanges);
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
  ): Promise<void> {
    const metadata = fitQuestsMetadata(log, pendingUserChanges);
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      pluginId: QUESTS_METADATA_NAMESPACE,
      set: JSON.parse(JSON.stringify(metadata)) as Record<string, JsonValue>,
    });
    bb.realtime.publish(QUESTS_REALTIME_CHANNEL, { threadId });
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
    if (!isCopyableFork(target)) return loaded(empty, []);
    const source = await read(target.sourceThreadId);
    const copy = source?.saved ?? empty;
    await write(threadId, copy, []);
    return loaded(copy, []);
  }

  return {
    getLog: (threadId) => withThreadLock(threadId, async () => viewOf((await load(threadId)).log)),

    runTool: (threadId, action) =>
      withThreadLock(threadId, async () => {
        const { log, saved, pendingUserChanges } = await load(threadId);
        const result = log.execute(action);
        const changed = result.success && !READ_ONLY_ACTIONS.has(action.type);
        if (changed || pendingUserChanges.length > 0) {
          await write(threadId, changed ? log.toJSON() : saved, []);
        }
        return {
          text: withUserChanges(pendingUserChanges, result.message),
          isError: !result.success,
        };
      }),

    mutate: (threadId, action) =>
      withThreadLock(threadId, async () => {
        const { log, pendingUserChanges } = await load(threadId);
        const result = log.execute(action);
        if (!result.success) throw new Error(result.message);
        await write(threadId, log.toJSON(), addUserChange(pendingUserChanges, result.message));
        return { message: result.message, view: viewOf(log) };
      }),

    copyFork: async (thread) => {
      if (!isCopyableFork(thread)) return;
      await withThreadLock(thread.id, () => load(thread.id, thread));
    },
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
): QuestsMetadata {
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
  return { progress, log: { ...log, history, redoStack }, pendingUserChanges: pending };
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

function viewOf(log: QuestLog): QuestView {
  return { quests: log.getAll(), progress: questProgress(log.getAll()) };
}

function withUserChanges(changes: string[], message: string): string {
  if (changes.length === 0) return message;
  const list = changes.map((change) => `- ${change.replaceAll("\n", "\n  ")}`).join("\n");
  return `${USER_CHANGES_PREFIX}\n${list}\n\n${message}`;
}

function isCopyableFork<T extends ForkOrigin>(thread: T): thread is T & { sourceThreadId: string } {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId !== "side-chat" &&
    thread.sourceThreadId !== null
  );
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
