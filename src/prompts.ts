import { formatPlanStatus } from "./quest/formatters.js";
import type { Quest, Step } from "./quest/types.js";

/** The quest tool's usage rules, shared by bb's thread instructions and pi's tool guidelines. */
export const QUEST_INSTRUCTIONS = [
  "Quests are this thread's live plan. They keep you on track through long work, failed turns and steering, and show the user your progress; the user can edit them too.",
  "Use quests for work with several steps or more than one turn: one quest per deliverable you can check, split into steps when it is big. Skip them for a single-pass answer or a quick read-only look.",
  "Keep the log current while you work: toggle a quest or step done in the same message as your next action, not in one batch at the end.",
  "Revisit the log when the user redirects or adds work, when you resume after an error or interruption, when a minion reports back, and before your final answer.",
  "When the plan changes, change the log: add, update or delete quests instead of leaving stale ones.",
  "Toggle marks done; never append DONE to a description. A parent is done only after its steps. Use the hex ids in brackets, not positions.",
  "For the full guide, call the quest tool with action: 'skill'.",
] as const;

export const USER_CHANGES_PREFIX = "The user changed the quest log:";

export function formatUserChanges(changes: readonly string[]): string {
  const list = changes.map((change) => `- ${change.replaceAll("\n", "\n  ")}`).join("\n");
  return `${USER_CHANGES_PREFIX}\n${list}`;
}

/** How every note starts, so bb's dispatch checkpoint can recognize one. */
export const QUEST_NOTE_PREFIX = "[Quests]";

const NOTE_OPEN_LIMIT = 5;

/**
 * The note an extension adds to a new request: the plan's state, why the agent gets it and the
 * user's unseen edits. `stale` means the agent has not updated the log since the user's previous message.
 */
export function formatQuestNote(
  quests: readonly (Quest | Step)[],
  { stale, userChanges }: { stale: boolean; userChanges: readonly string[] },
): string {
  const lines = [`${QUEST_NOTE_PREFIX} ${formatPlanStatus(quests)}`];
  const open = quests.filter((quest) => !("parentId" in quest) && !quest.done);
  if (open.length > 0) {
    const shown = open.slice(0, NOTE_OPEN_LIMIT).map((quest) => {
      const steps = quests.filter((step) => "parentId" in step && step.parentId === quest.id);
      const done = steps.filter((step) => step.done).length;
      return steps.length > 0
        ? `[${quest.id}] ${quest.description} (${done} of ${steps.length} steps done)`
        : `[${quest.id}] ${quest.description}`;
    });
    const more = open.length > NOTE_OPEN_LIMIT ? `; and ${open.length - NOTE_OPEN_LIMIT} more` : "";
    lines.push(`Open: ${shown.join("; ")}${more}.`);
  }
  if (userChanges.length > 0) lines.push(formatUserChanges(userChanges));
  if (stale) {
    lines.push(
      "You have not updated the quests since the user's previous message. If this request changes the plan, update them; if not, carry on.",
    );
  }
  return lines.join("\n");
}
