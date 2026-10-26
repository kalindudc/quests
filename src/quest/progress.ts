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

export type NextQuest = { quest: Quest | Step; parent: Quest | null };

/** The first open step of the first unfinished top-level quest, or that quest when none of its steps is open. */
export function nextQuest(quests: readonly (Quest | Step)[]): NextQuest | null {
  const parent = quests.find((quest): quest is Quest => !("parentId" in quest) && !quest.done);
  if (parent === undefined) return null;
  const step = quests.find(
    (quest) => "parentId" in quest && quest.parentId === parent.id && !quest.done,
  );
  return step === undefined ? { quest: parent, parent: null } : { quest: step, parent };
}
