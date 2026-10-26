import {
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  experimental_useSidebarThreads,
  type StandardSchemaV1,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { Quest, Step } from "../../../src/quest/types.js";
import type { rpcContract } from "../server.js";
import { QUIET_AFTER_MS, RPC_TAGS, STEER_PROVIDERS } from "../shared.js";
import type { QuestMutation, QuestView } from "../store.js";

// The page's copy of the RPC contract: the same methods and tags, with schemas that pass every
// value through, so zod stays out of the page bundle. The server validates both directions.
const unchecked: StandardSchemaV1 = {
  "~standard": { version: 1, vendor: "quests", validate: (value: unknown) => ({ value }) },
};
export const contract = Object.fromEntries(
  Object.entries(RPC_TAGS).map(([method, tags]) => [
    method,
    { input: unchecked, output: unchecked, ...tags },
  ]),
) as unknown as typeof rpcContract;

/** One thread's quest log, shared through bb's query cache by every surface that shows it. */
export function useQuestLog(threadId: string) {
  return experimental_useRpcQuery({ contract, method: "getLog", input: { threadId } });
}

/** Changes from the page; bb refreshes the log once the server acknowledges one. */
export function useQuestChanges(threadId: string) {
  const mutation = experimental_useRpcMutation({ contract, method: "mutate" });
  const tell = experimental_useRpcMutation({ contract, method: "tell" });
  return {
    change: (action: QuestMutation) => mutation.mutate({ threadId, action }),
    pending: mutation.isPending,
    error: mutation.error ?? tell.error,
    tell: () => tell.mutate({ threadId }),
    telling: tell.isPending,
  };
}

/** When each viewed thread's current turn was first seen running, kept while any view shows it. */
const runs = new Map<string, { since: number | null; viewers: number }>();

/**
 * Whether the thread's agent is working, and since when this page has seen it working. A page
 * opened mid-turn counts from when it first saw the turn, so it never calls a log quiet too early;
 * once no view shows the thread, the start is forgotten, since the turn may end unseen.
 */
export function useThreadRun(threadId: string): {
  running: boolean;
  since: number | null;
  canSteer: boolean;
} {
  const { threads } = experimental_useSidebarThreads();
  const thread = threads.find((candidate) => candidate.id === threadId);
  const running = thread?.status === "active";
  let run = runs.get(threadId);
  if (run === undefined) {
    run = { since: null, viewers: 0 };
    runs.set(threadId, run);
  }
  if (!running) run.since = null;
  else if (run.since === null) run.since = Date.now();
  useEffect(() => {
    const current = runs.get(threadId) ?? { since: null, viewers: 0 };
    current.viewers += 1;
    runs.set(threadId, current);
    return () => {
      current.viewers -= 1;
      if (current.viewers <= 0 && runs.get(threadId) === current) runs.delete(threadId);
    };
  }, [threadId]);
  return {
    running,
    since: run.since,
    canSteer: thread !== undefined && STEER_PROVIDERS.has(thread.providerId),
  };
}

const CLOCK_TICK_MS = 30_000;

/** The current time, refreshed every 30 seconds while `live`. */
export function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/**
 * Minutes since the agent last changed the log, once a working agent has left its open quests
 * unchanged past the quiet threshold (counted from when this page saw the turn running, at the
 * earliest); null while it is under the threshold, the agent is idle or nothing is open.
 */
export function useQuietMinutes(threadId: string, view: QuestView | undefined): number | null {
  const { running, since } = useThreadRun(threadId);
  const open = view?.quests.some((quest) => !quest.done) ?? false;
  const now = useNow(running && open);
  if (!running || !open || view?.agentChangedAt == null || since === null) return null;
  const quietFor = now - Math.max(view.agentChangedAt, since);
  return quietFor >= QUIET_AFTER_MS ? Math.floor((now - view.agentChangedAt) / 60_000) : null;
}

/** A short age for a tight space: 12m, 3h, 2d. */
export function shortAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

export function topLevel(quests: readonly (Quest | Step)[]): Quest[] {
  return quests.filter((quest): quest is Quest => !("parentId" in quest));
}

export function stepsOf(quests: readonly (Quest | Step)[], parentId: string): Step[] {
  return quests.filter(
    (quest): quest is Step => "parentId" in quest && quest.parentId === parentId,
  );
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
