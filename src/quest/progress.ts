import type { Quest, Step } from "./types.js";

export type QuestProgress = { done: number; total: number; current: string | null };

/** Counts quests and steps alike; `current` is the first unfinished top-level quest. */
export function questProgress(quests: readonly (Quest | Step)[]): QuestProgress {
  return {
    done: quests.filter((quest) => quest.done).length,
    total: quests.length,
    current: quests.find((quest) => !("parentId" in quest) && !quest.done)?.description ?? null,
  };
}
