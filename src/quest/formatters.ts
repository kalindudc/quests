import { nextQuest, questProgress } from "./progress.js";
import { QUEST_ACTIONS, type Quest, type QuestActionType, type Step } from "./types.js";

/**
 * Error message design guidelines
 *
 * All error messages should follow a consistent three-part pattern:
 *   1. PROBLEM — state what went wrong clearly and concisely
 *   2. RULE    — explain the constraint or invariant that was violated
 *   3. RECOVERY HINT — suggest the next valid action the caller can take
 *
 * Example:
 *   "Quest [01] has incomplete steps. A parent quest can only be marked
 *    done after all its steps are complete. Try toggling the steps first."
 *
 * Keep messages actionable. Agents should never be left guessing why something
 * failed or what to do next.
 */

export function formatQuestList(
  quests: { id: string; description: string; done: boolean; parentId?: string }[],
): string {
  if (quests.length === 0) return "No quests.";

  const lines: string[] = [];
  let pos = 1;
  for (const q of quests) {
    if (q.parentId) {
      lines.push(`   [${q.id}] [${q.done ? "x" : " "}] ${q.description}`);
    } else {
      lines.push(`#${pos} [${q.id}] [${q.done ? "x" : " "}] ${q.description}`);
      pos++;
    }
  }
  return lines.join("\n");
}

export function formatAddResult(q: { id: string; description: string }): string {
  return `Added quest [${q.id}]: ${q.description}`;
}

export function formatBatchAddResult(added: { id: string; description: string }[]): string {
  return `Added ${added.length} quests:\n${added.map((q) => `[${q.id}]: ${q.description}`).join("\n")}`;
}

export function formatSplitResult(
  parentId: string,
  steps: { id: string; description: string }[],
): string {
  const noun = steps.length === 1 ? "step" : "steps";
  const lines = steps.map((step) => `[${step.id}]: ${step.description}`);
  return [`Split quest [${parentId}] into ${steps.length} ${noun}:`, ...lines].join("\n");
}

/** What is done and what comes next, so a result shows the plan without a list call. */
export function formatPlanStatus(quests: readonly (Quest | Step)[]): string {
  const { done, total } = questProgress(quests);
  if (total === 0) return "The quest log is empty.";
  const next = nextQuest(quests);
  if (next === null) return `${done} of ${total} done. Every quest is done.`;
  const { quest, parent } = next;
  let note = "";
  if (parent !== null) note = ` (a step of [${parent.id}])`;
  else if (quests.some((step) => "parentId" in step && step.parentId === quest.id)) {
    note = " (all its steps are done; toggle it once the quest itself is complete)";
  }
  return `${done} of ${total} done. Next: [${quest.id}] ${clip(quest.description)}${note}`;
}

const STATUS_DESCRIPTION_LIMIT = 80;

function clip(text: string): string {
  return text.length > STATUS_DESCRIPTION_LIMIT
    ? `${text.slice(0, STATUS_DESCRIPTION_LIMIT - 1)}…`
    : text;
}

const PLAN_STATUS_SKIPPED: ReadonlySet<QuestActionType> = new Set([
  QUEST_ACTIONS.list,
  QUEST_ACTIONS.rules,
  QUEST_ACTIONS.skill,
]);

/** The quest tool's text for the agent: a successful change also reports the plan status. */
export function formatToolResult(
  action: QuestActionType,
  result: { success: boolean; message: string },
  quests: readonly (Quest | Step)[],
): string {
  if (!result.success || PLAN_STATUS_SKIPPED.has(action)) return result.message;
  return `${result.message}\n${formatPlanStatus(quests)}`;
}

export function formatToggleResult(id: string, done: boolean): string {
  return `Quest [${id}] ${done ? "done" : "undone"}`;
}

export function formatBatchToggleResult(toggled: { id: string; done: boolean }[]): string {
  return `Toggled ${toggled.length} tasks:\n${toggled
    .map((quest) => `[${quest.id}] ${quest.done ? "done" : "undone"}`)
    .join("\n")}`;
}

export function formatUpdateResult(q: { id: string; description: string }): string {
  return `Updated quest [${q.id}]: ${q.description}`;
}

export function formatDeleteResult(q: { id: string; description: string }): string {
  return `Deleted quest [${q.id}]: ${q.description}`;
}

export function formatBatchDeleteResult(deleted: { id: string; description: string }[]): string {
  return `Deleted ${deleted.length} tasks:\n${deleted.map((quest) => `[${quest.id}] ${quest.description}`).join("\n")}`;
}

export function formatNotFound(id: string): string {
  return `Quest [${id}] not found. IDs are random hex strings shown in brackets. Use the list action to see valid IDs.`;
}

export function formatBlockedBySteps(id: string): string {
  return `Quest [${id}] has incomplete steps. A parent quest can only be marked done or deleted after all its steps are complete. Toggle the steps first, or delete them if they are no longer needed.`;
}

export function formatStepCannotHaveSteps(id: string): string {
  return `Step [${id}] cannot have nested steps. The quest system only supports one level of nesting. Use a top-level quest as the parent instead.`;
}

export function formatEmptyDescriptionsError(): string {
  return `Every description in a batch must be non-empty. Remove empty strings or split the batch into separate add calls.`;
}

export function formatMissingDescriptionsError(action = "add"): string {
  return `At least one description is required for the ${action} action. Provide a description string to create a quest.`;
}

export function formatIdRequiredError(action: string): string {
  return `An id is required for the ${action} action. Use the list action to see valid quest IDs. IDs are the hex strings shown in square brackets.`;
}

export function formatDescriptionRequiredError(): string {
  return `A description is required for the update action. Provide a non-empty string to update the quest.`;
}

export function formatTargetIdRequiredError(): string {
  return `A targetId is required for the reorder action. Provide the hex ID of the quest to insert before.`;
}

export function formatReorderNotFoundError(): string {
  return `Quest not found or is a step. Reorder only works on top-level quests. Use the list action to verify the ID and ensure it is a top-level quest.`;
}

export function formatParentNotFoundError(id: string): string {
  return `Parent quest [${id}] not found. Use the list action to see valid parent IDs.`;
}

export function formatParentDoneError(id: string): string {
  return `Cannot add a step to completed parent quest [${id}]. Steps can only be added to open parents. Reopen the parent first if you need to add more work.`;
}

export function formatUnknownActionError(action: string): string {
  return `Unknown action: ${action}. Use the list action or check the tool schema for supported actions.`;
}

export function formatNothingToUndoError(): string {
  return `Nothing to undo. The history is empty because no mutating actions have been performed yet.`;
}

export function formatNothingToRedoError(): string {
  return `Nothing to redo. The redo stack is empty because no actions have been undone yet.`;
}

export function formatReorderedQuestNotFoundError(): string {
  return `Reordered quest not found. It may have been deleted or cleared since the reorder was recorded.`;
}

export function formatReparentResult(
  q: { id: string; description: string },
  parentId?: string,
): string {
  return parentId
    ? `Moved quest [${q.id}] under [${parentId}]: ${q.description}`
    : `Promoted quest [${q.id}] to top-level: ${q.description}`;
}

export function formatReparentTargetNotFoundError(id: string): string {
  return `Target quest [${id}] not found. Use the list action to see valid parent IDs.`;
}

export function formatReparentTargetIsStepError(id: string): string {
  return `Step [${id}] cannot be a parent. The quest system only supports one level of nesting. Use a top-level quest as the parent instead.`;
}

export function formatReparentTargetDoneError(id: string): string {
  return `Cannot reparent under completed parent [${id}]. Steps can only be added to open parents.`;
}

export function formatReparentDemoteHasStepsError(id: string): string {
  return `Quest [${id}] has steps and cannot be demoted to a step. Delete or reparent its steps first.`;
}

export function formatReparentSelfParentError(id: string): string {
  return `Quest [${id}] cannot be its own parent. Choose a different parent ID.`;
}
