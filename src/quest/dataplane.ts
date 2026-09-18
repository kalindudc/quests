import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type ResolvedConfig } from "../config.js";
import { logger } from "../logger.js";
import { getQuestSkillDocument } from "../prompts.js";
import {
  formatAddResult,
  formatBatchAddResult,
  formatBatchDeleteResult,
  formatBatchToggleResult,
  formatBlockedBySteps,
  formatDeleteResult,
  formatDescriptionRequiredError,
  formatEmptyDescriptionsError,
  formatIdRequiredError,
  formatMissingDescriptionsError,
  formatNotFound,
  formatNothingToRedoError,
  formatNothingToUndoError,
  formatParentDoneError,
  formatParentNotFoundError,
  formatQuestList,
  formatReorderedQuestNotFoundError,
  formatReorderNotFoundError,
  formatReparentDemoteHasStepsError,
  formatReparentResult,
  formatReparentSelfParentError,
  formatReparentTargetDoneError,
  formatReparentTargetIsStepError,
  formatReparentTargetNotFoundError,
  formatStepCannotHaveSteps,
  formatTargetIdRequiredError,
  formatToggleResult,
  formatUnknownActionError,
  formatUpdateResult,
} from "./formatters.js";
import { QUEST_ACTIONS, type Quest, type Step } from "./types.js";

type DeletedQuestSnapshot = {
  deletedIds: string[];
  previousQuests: Quest[];
  previousSteps: Step[];
};

export type HistoryEntry =
  | { type: typeof QUEST_ACTIONS.add; id: string; parentId?: string }
  | { type: typeof QUEST_ACTIONS.toggle; ids: string[] }
  | { type: typeof QUEST_ACTIONS.update; id: string; previousDescription: string }
  | ({ type: typeof QUEST_ACTIONS.delete; ids: string[] } & DeletedQuestSnapshot)
  | {
      type: typeof QUEST_ACTIONS.clear;
      previousQuests: Quest[];
      previousSteps?: Step[];
      all: false;
    }
  | { type: typeof QUEST_ACTIONS.clear; quests: Quest[]; steps?: Step[]; all: true }
  | {
      type: typeof QUEST_ACTIONS.reorder;
      quest: Quest;
      oldIndex: number;
      previousIds: string[];
      targetId: string;
    }
  | {
      type: typeof QUEST_ACTIONS.reparent;
      id: string;
      previousParentId?: string;
      previousQuestIndex?: number;
    };

export type QuestAction =
  | { type: typeof QUEST_ACTIONS.add; descriptions?: string[] }
  | { type: typeof QUEST_ACTIONS.split; id?: string; descriptions?: string[] }
  | { type: typeof QUEST_ACTIONS.add_step; id?: string; descriptions?: string[] }
  | { type: typeof QUEST_ACTIONS.list }
  | { type: typeof QUEST_ACTIONS.toggle; id?: string; ids?: string[] }
  | { type: typeof QUEST_ACTIONS.update; id?: string; description?: string }
  | { type: typeof QUEST_ACTIONS.delete; id?: string; ids?: string[] }
  | { type: typeof QUEST_ACTIONS.clear; all?: boolean }
  | { type: typeof QUEST_ACTIONS.reorder; id?: string; targetId?: string }
  | { type: typeof QUEST_ACTIONS.undo }
  | { type: typeof QUEST_ACTIONS.redo }
  | { type: typeof QUEST_ACTIONS.reparent; id?: string; parentId?: string }
  | { type: typeof QUEST_ACTIONS.rules }
  | { type: typeof QUEST_ACTIONS.skill };

export type RedoEntry =
  | { type: typeof QUEST_ACTIONS.add; quest: Quest | Step }
  | { type: typeof QUEST_ACTIONS.toggle; ids: string[] }
  | { type: typeof QUEST_ACTIONS.update; id: string; description: string }
  | { type: typeof QUEST_ACTIONS.delete; ids: string[] }
  | { type: typeof QUEST_ACTIONS.clear; all: boolean }
  | { type: typeof QUEST_ACTIONS.reorder; id: string; targetId: string }
  | { type: typeof QUEST_ACTIONS.reparent; id: string; parentId?: string };

export type QuestOperationResult = {
  success: boolean;
  message: string;
  quest?: Quest;
  quests?: Quest[];
};

type ToggleBatchResult =
  | { quests: (Quest | Step)[]; ids: string[] }
  | { error: "notFound" | "blocked"; id: string };

type DeleteBatchResult =
  | { quests: (Quest | Step)[]; ids: string[] }
  | { error: "notFound" | "blocked"; id: string };

/**
 * In-memory quest data plane.
 *
 * Holds quest state, mutation history, and exposes `execute()` as the
 * single entry point for all adapter layers (commands, tools, etc.).
 */
export class QuestLog {
  private quests: Quest[] = [];
  private steps: Step[] = [];
  private usedIds: Set<string> = new Set();
  private history: HistoryEntry[] = [];
  private redoStack: RedoEntry[] = [];
  private inRedo = false;

  private readonly ID_LENGTH: number;
  private readonly MAX_IDS: number;

  constructor(config: ResolvedConfig = DEFAULT_CONFIG) {
    this.ID_LENGTH = config.ids.length;
    this.MAX_IDS = 16 ** this.ID_LENGTH;
  }

  private generateId(): string {
    if (this.usedIds.size >= this.MAX_IDS) {
      logger.debug("quests:state", "generate-id-exhausted", { usedIds: this.usedIds.size });
      throw new Error("No available quest IDs. Clear done or all quests to free up IDs.");
    }

    let id: string;
    do {
      id = Math.floor(Math.random() * this.MAX_IDS)
        .toString(16)
        .padStart(this.ID_LENGTH, "0")
        .toLowerCase();
    } while (this.usedIds.has(id));

    this.usedIds.add(id);
    return id;
  }

  /*
   * Runs `fn` and, if it throws, restores all mutable state to the snapshot
   * taken beforehand. Makes multi-step mutations (batch add, split) atomic so a
   * partial failure (e.g. ID exhaustion mid-loop) cannot leave orphaned quests,
   * steps, history, or used IDs behind.
   */
  private runTransaction<T>(fn: () => T): T {
    const quests = [...this.quests];
    const steps = [...this.steps];
    const history = [...this.history];
    const usedIds = new Set(this.usedIds);
    const redoStack = [...this.redoStack];
    try {
      return fn();
    } catch (err) {
      this.quests = quests;
      this.steps = steps;
      this.history = history;
      this.usedIds = usedIds;
      this.redoStack = redoStack;
      throw err;
    }
  }
  private undoHandlers: {
    [K in HistoryEntry["type"]]: (entry: Extract<HistoryEntry, { type: K }>) => {
      success: boolean;
      message: string;
    };
  } = {
    [QUEST_ACTIONS.add]: (entry) => {
      this.quests = this.quests.filter((q) => q.id !== entry.id);
      this.steps = this.steps.filter((q) => q.id !== entry.id);
      this.usedIds.delete(entry.id);

      logger.debug("quests:state", "revert-add", {
        id: entry.id,
        total: this.quests.length + this.steps.length,
      });
      return { success: true, message: `Reverted add quest [${entry.id}]` };
    },
    [QUEST_ACTIONS.toggle]: (entry) => {
      const quests = entry.ids.map((id) => this.findById(id));
      const missingId = entry.ids.find((_, index) => !quests[index]);

      if (missingId) {
        logger.debug("quests:state", "revert-toggle-not-found", { ids: entry.ids, missingId });
        return { success: false, message: formatNotFound(missingId) };
      }

      const resolvedQuests = quests.filter((quest): quest is Quest | Step => quest !== undefined);
      for (const quest of resolvedQuests) {
        quest.done = !quest.done;
      }

      logger.debug("quests:state", "revert-toggle", {
        ids: entry.ids,
        done: resolvedQuests.map((quest) => quest.done),
      });
      return {
        success: true,
        message:
          entry.ids.length === 1
            ? `Reverted toggle for quest [${entry.ids[0]}]`
            : `Reverted toggle for ${entry.ids.length} quests`,
      };
    },
    [QUEST_ACTIONS.update]: (entry) => {
      const quest = this.findById(entry.id);
      if (quest) {
        quest.description = entry.previousDescription;
        logger.debug("quests:state", "revert-update", { id: entry.id });
        return { success: true, message: `Reverted update for quest [${entry.id}]` };
      }

      logger.debug("quests:state", "revert-update-not-found", { id: entry.id });
      return { success: false, message: formatNotFound(entry.id) };
    },
    [QUEST_ACTIONS.delete]: (entry) => {
      this.quests = [...entry.previousQuests];
      this.steps = [...entry.previousSteps];
      this.usedIds = new Set([...this.quests, ...this.steps].map((quest) => quest.id));

      logger.debug("quests:state", "revert-delete", {
        ids: entry.deletedIds,
        total: this.quests.length + this.steps.length,
      });
      return {
        success: true,
        message:
          entry.ids.length === 1
            ? `Reverted delete for quest [${entry.ids[0]}]`
            : `Reverted delete for ${entry.ids.length} tasks`,
      };
    },
    [QUEST_ACTIONS.clear]: (entry) => {
      if ("previousQuests" in entry) {
        const restoredCount =
          entry.previousQuests.length +
          (entry.previousSteps?.length ?? 0) -
          (this.quests.length + this.steps.length);
        this.quests = [...entry.previousQuests];
        this.steps = [...(entry.previousSteps ?? [])];
        this.usedIds = new Set([...this.quests, ...this.steps].map((q) => q.id));

        return {
          success: true,
          message: `Reverted clear (${restoredCount} quests restored)`,
        };
      }

      this.quests = [...entry.quests];
      this.steps = [...(entry.steps ?? [])];
      this.usedIds = new Set([...this.quests, ...this.steps].map((q) => q.id));

      return { success: true, message: `Reverted clear (${entry.quests.length} quests restored)` };
    },
    [QUEST_ACTIONS.reorder]: (entry) => {
      const currentIndex = this.quests.indexOf(entry.quest);
      if (currentIndex === -1)
        return { success: false, message: formatReorderedQuestNotFoundError() };

      this.quests.splice(currentIndex, 1);
      this.quests.splice(entry.oldIndex, 0, entry.quest);
      for (let i = 0; i < this.quests.length; i++) {
        this.quests[i].id = entry.previousIds[i];
      }

      return { success: true, message: `Reverted reorder for quest [${entry.quest.id}]` };
    },
    [QUEST_ACTIONS.reparent]: (entry) => {
      const quest = this.findById(entry.id);
      if (!quest) return { success: false, message: formatNotFound(entry.id) };
      if (entry.previousParentId !== undefined) {
        this.quests = this.quests.filter((q) => q.id !== entry.id);
        (quest as Step).parentId = entry.previousParentId;
        if (!this.steps.some((s) => s.id === entry.id)) this.steps.push(quest as Step);
      } else if (entry.previousQuestIndex !== undefined) {
        this.steps = this.steps.filter((s) => s.id !== entry.id);
        delete (quest as Partial<Step>).parentId;
        this.quests.splice(entry.previousQuestIndex, 0, quest);
      }
      return { success: true, message: `Reverted reparent for quest [${entry.id}]` };
    },
  };

  private redoHandlers: {
    [K in RedoEntry["type"]]: (entry: Extract<RedoEntry, { type: K }>) => {
      success: boolean;
      message: string;
    };
  } = {
    [QUEST_ACTIONS.add]: (entry) => {
      if ("parentId" in entry.quest && entry.quest.parentId) {
        this.steps.push(entry.quest as Step);
        this.history.push({
          type: QUEST_ACTIONS.add,
          id: entry.quest.id,
          parentId: entry.quest.parentId,
        });
      } else {
        this.quests.push(entry.quest);
        this.history.push({ type: QUEST_ACTIONS.add, id: entry.quest.id });
      }
      this.usedIds.add(entry.quest.id);
      return { success: true, message: `Redone add quest [${entry.quest.id}]` };
    },
    [QUEST_ACTIONS.toggle]: (entry) => {
      const result = this.toggleMany(entry.ids);
      if ("error" in result) {
        return {
          success: false,
          message:
            result.error === "blocked"
              ? formatBlockedBySteps(result.id)
              : formatNotFound(result.id),
        };
      }

      return {
        success: true,
        message:
          entry.ids.length === 1
            ? `Redone toggle for quest [${entry.ids[0]}]`
            : `Redone toggle for ${entry.ids.length} quests`,
      };
    },
    [QUEST_ACTIONS.update]: (entry) => {
      const q = this.update(entry.id, entry.description);
      if (q) return { success: true, message: `Redone update for quest [${entry.id}]` };
      return { success: false, message: formatNotFound(entry.id) };
    },
    [QUEST_ACTIONS.delete]: (entry) => {
      const result = this.deleteMany(entry.ids);
      if ("error" in result) {
        return {
          success: false,
          message:
            result.error === "blocked"
              ? formatBlockedBySteps(result.id)
              : formatNotFound(result.id),
        };
      }

      const firstQuest = result.quests[0];
      return {
        success: true,
        message:
          entry.ids.length === 1 && firstQuest
            ? `Redone delete for quest [${firstQuest.id}]`
            : `Redone delete for ${entry.ids.length} tasks`,
      };
    },
    [QUEST_ACTIONS.clear]: (entry) => {
      const count = this.clear(entry.all);
      return {
        success: true,
        message: `Redone clear (${count} quests ${entry.all ? "" : "completed "}cleared)`,
      };
    },
    [QUEST_ACTIONS.reorder]: (entry) => {
      const q = this.reorder(entry.id, entry.targetId);
      if (q) return { success: true, message: `Redone reorder for quest [${entry.id}]` };
      return { success: false, message: formatReorderedQuestNotFoundError() };
    },
    [QUEST_ACTIONS.reparent]: (entry) => {
      try {
        const q = this.reparent(entry.id, entry.parentId);
        if (q) return { success: true, message: `Redone reparent for quest [${entry.id}]` };
        return { success: false, message: formatNotFound(entry.id) };
      } catch (err) {
        return {
          success: false,
          message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  redo(): QuestOperationResult {
    const entry = this.redoStack.pop();
    if (!entry) {
      return { success: false, message: formatNothingToRedoError() };
    }
    const handler = this.redoHandlers[entry.type];
    if (handler) {
      this.inRedo = true;
      const result = handler(entry as never);
      this.inRedo = false;
      return result;
    }
    return { success: false, message: "Unknown redo entry" };
  }

  /*
   * Returns all quests including steps, inserted in order
   * steps are returned immediately after their parent quest
   */
  getAll(): Quest[] {
    const result: Quest[] = [];
    for (const q of this.quests) {
      result.push(q);
      result.push(...this.steps.filter((step) => step.parentId === q.id));
    }
    return result;
  }

  /*
   * Returns only top-level quests. Steps should be accessed via `getSteps()`.
   */
  getQuests(): Quest[] {
    return [...this.quests];
  }

  /*
   * Returns steps for a given parent quest ID. Steps are not included in `getQuests()`.
   */
  getSteps(parentId: string): Step[] {
    return this.steps.filter((step) => step.parentId === parentId);
  }

  getParent(step: Step): Quest | undefined {
    return this.quests.find((q) => q.id === step.parentId);
  }

  private findById(id: string): Quest | Step | undefined {
    return this.quests.find((q) => q.id === id) ?? this.steps.find((step) => step.id === id);
  }

  private normalizeIds(ids: string[]): string[] {
    return [...new Set(ids)];
  }

  private validateToggleBatch(ids: string[]): ToggleBatchResult {
    const normalizedIds = this.normalizeIds(ids);
    const quests: (Quest | Step)[] = [];

    for (const id of normalizedIds) {
      const quest = this.findById(id);
      if (!quest) {
        logger.debug("quests:state", "toggle-not-found", { id });
        return { error: "notFound", id };
      }
      quests.push(quest);
    }

    const toggledIds = new Set(normalizedIds);
    for (const quest of quests) {
      if (quest.done || "parentId" in quest) continue;

      const steps = this.getSteps(quest.id);
      const hasIncompleteSteps = steps.some((step) => {
        const finalDone = toggledIds.has(step.id) ? !step.done : step.done;
        return !finalDone;
      });

      if (hasIncompleteSteps) {
        logger.debug("quests:state", "toggle-blocked-steps", { id: quest.id, ids: normalizedIds });
        return { error: "blocked", id: quest.id };
      }
    }

    return { quests, ids: normalizedIds };
  }

  private applyToggleBatch(quests: (Quest | Step)[], ids: string[]): Quest[] {
    for (const quest of quests) {
      quest.done = !quest.done;
    }

    this.history.push({ type: QUEST_ACTIONS.toggle, ids });
    logger.debug("quests:state", QUEST_ACTIONS.toggle, {
      ids,
      total: this.quests.length + this.steps.length,
    });

    return quests;
  }

  toggleMany(ids: string[]): ToggleBatchResult {
    if (!this.inRedo) this.redoStack = [];
    const result = this.validateToggleBatch(ids);
    if ("error" in result) return result;

    return {
      ids: result.ids,
      quests: this.applyToggleBatch(result.quests, result.ids),
    };
  }

  getUsedIds(): string[] {
    return Array.from(this.usedIds);
  }

  add(description: string): Quest {
    if (!this.inRedo) this.redoStack = [];
    const quest: Quest = {
      id: this.generateId(),
      description,
      done: false,
      createdAt: Date.now(),
    };

    this.quests.push(quest);
    this.history.push({ type: QUEST_ACTIONS.add, id: quest.id });

    logger.debug("quests:state", QUEST_ACTIONS.add, {
      id: quest.id,
      description,
      total: this.quests.length,
    });
    return quest;
  }

  addStep(description: string, parentId: string): Step {
    if (!this.inRedo) this.redoStack = [];
    if (this.steps.some((step) => step.id === parentId)) {
      throw new Error(formatStepCannotHaveSteps(parentId));
    }
    const parent = this.quests.find((q) => q.id === parentId);
    if (!parent) {
      throw new Error(formatParentNotFoundError(parentId));
    }
    if (parent.done) {
      throw new Error(formatParentDoneError(parentId));
    }
    const step: Step = {
      id: this.generateId(),
      description,
      done: false,
      createdAt: Date.now(),
      parentId,
    };
    this.steps.push(step);
    this.history.push({ type: QUEST_ACTIONS.add, id: step.id, parentId });
    logger.debug("quests:state", "add-step", {
      id: step.id,
      parentId,
      description,
      totalSteps: this.steps.length,
    });
    return step;
  }

  split(id: string, descriptions: string[]): Step[] {
    if (this.steps.some((step) => step.id === id)) {
      throw new Error(formatStepCannotHaveSteps(id));
    }
    const parent = this.quests.find((q) => q.id === id);
    if (!parent) throw new Error(formatNotFound(id));
    if (parent.done) throw new Error(formatParentDoneError(id));

    return this.runTransaction(() => {
      const created: Step[] = [];
      for (const desc of descriptions) {
        created.push(this.addStep(desc, id));
      }
      return created;
    });
  }

  toggle(id: string): Quest | Step | null | undefined {
    const result = this.toggleMany([id]);
    if ("error" in result) {
      return result.error === "blocked" ? null : undefined;
    }

    return result.quests[0];
  }

  update(id: string, description: string): Quest | Step | undefined {
    if (!this.inRedo) this.redoStack = [];
    const quest = this.findById(id);
    if (!quest) {
      logger.debug("quests:state", "update-not-found", { id });
      return undefined;
    }

    this.history.push({ type: QUEST_ACTIONS.update, id, previousDescription: quest.description });
    quest.description = description;

    logger.debug("quests:state", QUEST_ACTIONS.update, {
      id,
      description,
      total: this.quests.length + this.steps.length,
    });
    return quest;
  }

  private validateDeleteBatch(
    ids: string[],
  ): { ids: string[]; deletedIds: string[] } | { error: "notFound" | "blocked"; id: string } {
    const normalizedIds = this.normalizeIds(ids);
    const selectedIds = new Set(normalizedIds);
    const deletedIds = new Set<string>();

    for (const id of normalizedIds) {
      const quest = this.findById(id);
      if (!quest) {
        logger.debug("quests:state", "delete-not-found", { id });
        return { error: "notFound", id };
      }

      if ("parentId" in quest) {
        deletedIds.add(quest.id);
        continue;
      }

      const steps = this.getSteps(quest.id);
      const hasUnselectedIncompleteStep = steps.some(
        (step) => !step.done && !selectedIds.has(step.id),
      );
      if (hasUnselectedIncompleteStep) {
        logger.debug("quests:state", "delete-blocked-steps", { id: quest.id, ids: normalizedIds });
        return { error: "blocked", id: quest.id };
      }

      deletedIds.add(quest.id);
      for (const step of steps) {
        deletedIds.add(step.id);
      }
    }

    return { ids: normalizedIds, deletedIds: [...deletedIds] };
  }

  private applyDeleteBatch(ids: string[], deletedIds: string[]): Quest[] {
    const deletedIdSet = new Set(deletedIds);
    const previousQuests = [...this.quests];
    const previousSteps = [...this.steps];
    const deletedQuests = this.getAll().filter((quest) => deletedIdSet.has(quest.id));

    this.quests = this.quests.filter((quest) => !deletedIdSet.has(quest.id));
    this.steps = this.steps.filter((step) => !deletedIdSet.has(step.id));
    this.usedIds = new Set([...this.quests, ...this.steps].map((quest) => quest.id));
    this.history.push({
      type: QUEST_ACTIONS.delete,
      ids,
      deletedIds,
      previousQuests,
      previousSteps,
    });

    logger.debug("quests:state", QUEST_ACTIONS.delete, {
      ids,
      deletedIds,
      total: this.quests.length + this.steps.length,
    });

    return deletedQuests;
  }

  deleteMany(ids: string[]): DeleteBatchResult {
    if (!this.inRedo) this.redoStack = [];
    const result = this.validateDeleteBatch(ids);
    if ("error" in result) return result;

    return {
      ids: result.ids,
      quests: this.applyDeleteBatch(result.ids, result.deletedIds),
    };
  }

  delete(id: string): Quest | Step | null | undefined {
    const result = this.deleteMany([id]);
    if ("error" in result) {
      return result.error === "blocked" ? null : undefined;
    }

    return result.quests[0];
  }

  clear(all = false): number {
    if (!this.inRedo) this.redoStack = [];
    if (!all) {
      const doneParentIds = new Set(this.quests.filter((q) => q.done).map((q) => q.id));
      const done = this.quests.filter((q) => q.done);
      const removedSteps = this.steps.filter(
        (step) => step.done || doneParentIds.has(step.parentId),
      );
      const keptSteps = this.steps.filter(
        (step) => !step.done && !doneParentIds.has(step.parentId),
      );
      const previousQuests = [...this.quests];
      const previousSteps = [...this.steps];
      for (const q of done) this.usedIds.delete(q.id);
      for (const q of removedSteps) this.usedIds.delete(q.id);
      this.quests = this.quests.filter((q) => !q.done);
      this.steps = keptSteps;
      this.history.push({
        type: QUEST_ACTIONS.clear,
        previousQuests,
        previousSteps,
        all: false,
      });
      const count = done.length + removedSteps.length;
      logger.debug("quests:state", QUEST_ACTIONS.clear, { count, all });
      return count;
    }
    const count = this.quests.length + this.steps.length;
    this.history.push({
      type: QUEST_ACTIONS.clear,
      quests: [...this.quests],
      steps: [...this.steps],
      all: true,
    });
    this.quests = [];
    this.steps = [];
    this.usedIds.clear();
    logger.debug("quests:state", QUEST_ACTIONS.clear, { count, all });
    return count;
  }

  reorder(id: string, targetId: string): Quest | undefined {
    if (!this.inRedo) this.redoStack = [];
    if (this.steps.some((step) => step.id === id || step.id === targetId)) {
      logger.debug("quests:state", "reorder-step-rejected", { id, targetId });
      return undefined;
    }
    const idx = this.quests.findIndex((q) => q.id === id);
    if (idx === -1) {
      logger.debug("quests:state", "reorder-not-found", { id });
      return undefined;
    }

    const targetIdx = this.quests.findIndex((q) => q.id === targetId);
    if (targetIdx === -1) {
      logger.debug("quests:state", "reorder-target-not-found", { id, targetId });
      return undefined;
    }

    if (idx === targetIdx) {
      return this.quests[idx];
    }

    const previousIds = this.quests.map((q) => q.id);
    const [quest] = this.quests.splice(idx, 1);

    let insertIndex = targetIdx;
    if (idx < targetIdx) {
      insertIndex = targetIdx - 1;
    }

    this.quests.splice(insertIndex, 0, quest);
    this.history.push({ type: QUEST_ACTIONS.reorder, quest, oldIndex: idx, previousIds, targetId });
    logger.debug("quests:state", QUEST_ACTIONS.reorder, {
      id: quest.id,
      targetId,
      total: this.quests.length + this.steps.length,
    });

    return quest;
  }

  reparent(id: string, parentId?: string): Quest | Step | undefined {
    if (!this.inRedo) this.redoStack = [];
    const quest = this.findById(id);
    if (!quest) return undefined;

    if (parentId) {
      if (id === parentId) {
        throw new Error(formatReparentSelfParentError(id));
      }
      const target = this.findById(parentId);
      if (!target) {
        throw new Error(formatReparentTargetNotFoundError(parentId));
      }
      if ("parentId" in target) {
        throw new Error(formatReparentTargetIsStepError(parentId));
      }
      if (target.done) {
        throw new Error(formatReparentTargetDoneError(parentId));
      }
      if (!("parentId" in quest)) {
        const steps = this.getSteps(id);
        if (steps.length > 0) {
          throw new Error(formatReparentDemoteHasStepsError(id));
        }
      }
      const previousQuestIndex = this.quests.findIndex((q) => q.id === id);
      const previousParentId = "parentId" in quest ? quest.parentId : undefined;
      this.quests = this.quests.filter((q) => q.id !== id);
      this.steps = this.steps.filter((s) => s.id !== id);
      (quest as Step).parentId = parentId;
      this.steps.push(quest as Step);
      this.history.push({
        type: QUEST_ACTIONS.reparent,
        id,
        previousParentId,
        previousQuestIndex: previousQuestIndex === -1 ? undefined : previousQuestIndex,
      });
    } else {
      if (!("parentId" in quest)) {
        return quest;
      }
      const previousParentId = quest.parentId;
      this.steps = this.steps.filter((s) => s.id !== id);
      delete (quest as Partial<Step>).parentId;
      this.quests.push(quest);
      this.history.push({ type: QUEST_ACTIONS.reparent, id, previousParentId });
    }

    logger.debug("quests:state", QUEST_ACTIONS.reparent, {
      id,
      parentId,
      total: this.quests.length + this.steps.length,
    });

    return quest;
  }

  undo(): QuestOperationResult {
    const entry = this.history.pop();
    if (!entry) {
      logger.debug("quests:state", "undo-empty");
      return { success: false, message: formatNothingToUndoError() };
    }

    logger.debug("quests:state", "undo", { type: entry.type });
    this.redoStack.push(this.buildRedoEntry(entry));

    const handler = this.undoHandlers[entry.type];
    if (handler) {
      return handler(entry as never);
    }

    logger.debug("quests:state", "undo-unknown", { type: (entry as { type: string }).type });
    return { success: false, message: "Unknown history entry" };
  }

  private buildRedoEntry(entry: HistoryEntry): RedoEntry {
    switch (entry.type) {
      case QUEST_ACTIONS.add: {
        const quest = this.findById(entry.id);
        if (!quest) throw new Error(formatNotFound(entry.id));
        return { type: QUEST_ACTIONS.add, quest };
      }
      case QUEST_ACTIONS.toggle:
        return { type: QUEST_ACTIONS.toggle, ids: entry.ids };
      case QUEST_ACTIONS.update:
        return {
          type: QUEST_ACTIONS.update,
          id: entry.id,
          description: this.findById(entry.id)?.description ?? entry.previousDescription,
        };
      case QUEST_ACTIONS.delete:
        return { type: QUEST_ACTIONS.delete, ids: entry.ids };
      case QUEST_ACTIONS.clear:
        return { type: QUEST_ACTIONS.clear, all: entry.all };
      case QUEST_ACTIONS.reorder:
        return { type: QUEST_ACTIONS.reorder, id: entry.quest.id, targetId: entry.targetId };
      case QUEST_ACTIONS.reparent: {
        const quest = this.findById(entry.id);
        if (!quest) throw new Error(formatNotFound(entry.id));
        return {
          type: QUEST_ACTIONS.reparent,
          id: entry.id,
          parentId: "parentId" in quest ? quest.parentId : undefined,
        };
      }
    }
  }

  /**
   * Execute a quest action and return a presentation-ready result.
   * This is the primary API for all adapter layers (commands, tools).
   */
  execute(action: QuestAction): QuestOperationResult {
    if (
      action.type !== QUEST_ACTIONS.list &&
      action.type !== QUEST_ACTIONS.rules &&
      action.type !== QUEST_ACTIONS.skill &&
      action.type !== QUEST_ACTIONS.undo &&
      action.type !== QUEST_ACTIONS.redo
    ) {
      this.redoStack = [];
    }
    switch (action.type) {
      case QUEST_ACTIONS.add: {
        if (action.descriptions && action.descriptions.length > 0) {
          if (action.descriptions.some((d) => !d || d.trim().length === 0)) {
            return {
              success: false,
              message: formatEmptyDescriptionsError(),
            };
          }
          if (action.descriptions.length === 1) {
            try {
              const [firstDesc] = action.descriptions;
              const q = this.add(firstDesc);

              return { success: true, message: formatAddResult(q) };
            } catch (err) {
              return {
                success: false,
                message: `Error: ${err instanceof Error ? err.message : String(err)}`,
              };
            }
          }
          const descriptions = action.descriptions;
          try {
            const added = this.runTransaction(() => {
              const result: { id: string; description: string }[] = [];
              for (const desc of descriptions) {
                const q = this.add(desc);
                result.push({ id: q.id, description: q.description });
              }
              return result;
            });

            return { success: true, message: formatBatchAddResult(added) };
          } catch (err) {
            return {
              success: false,
              message: `Error: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        }
        return {
          success: false,
          message: formatMissingDescriptionsError(),
        };
      }
      case QUEST_ACTIONS.list: {
        const quests = this.getAll();
        return { success: true, message: formatQuestList(quests) };
      }
      case QUEST_ACTIONS.toggle: {
        const ids = action.ids?.length ? action.ids : action.id ? [action.id] : undefined;
        if (!ids || ids.length === 0) {
          return { success: false, message: formatIdRequiredError("toggle") };
        }

        const result = this.toggleMany(ids);
        if ("error" in result) {
          return {
            success: false,
            message:
              result.error === "blocked"
                ? formatBlockedBySteps(result.id)
                : formatNotFound(result.id),
          };
        }

        if (result.quests.length === 1) {
          const quest = result.quests[0];
          if (!quest) {
            return { success: false, message: formatNotFound(result.ids[0]) };
          }

          return {
            success: true,
            message: formatToggleResult(result.ids[0], quest.done),
            quest,
          };
        }

        return {
          success: true,
          message: formatBatchToggleResult(
            result.quests.map((quest, index) => ({ id: result.ids[index], done: quest.done })),
          ),
          quests: result.quests,
        };
      }
      case QUEST_ACTIONS.update: {
        if (action.id === undefined) {
          return { success: false, message: formatIdRequiredError("update") };
        }

        if (!action.description || action.description.trim().length === 0) {
          return { success: false, message: formatDescriptionRequiredError() };
        }

        const q = this.update(action.id, action.description);
        if (!q) {
          return { success: false, message: formatNotFound(action.id) };
        }

        return { success: true, message: formatUpdateResult(q), quest: q };
      }
      case QUEST_ACTIONS.delete: {
        const ids = action.ids?.length ? action.ids : action.id ? [action.id] : undefined;
        if (!ids || ids.length === 0) {
          return { success: false, message: formatIdRequiredError("delete") };
        }

        const result = this.deleteMany(ids);
        if ("error" in result) {
          return {
            success: false,
            message:
              result.error === "blocked"
                ? formatBlockedBySteps(result.id)
                : formatNotFound(result.id),
          };
        }

        if (result.ids.length === 1) {
          const quest = result.quests[0];
          if (!quest) {
            return { success: false, message: formatNotFound(result.ids[0]) };
          }

          return { success: true, message: formatDeleteResult(quest), quest };
        }

        return {
          success: true,
          message: formatBatchDeleteResult(
            result.quests.map((quest) => ({ id: quest.id, description: quest.description })),
          ),
          quests: result.quests,
        };
      }
      case QUEST_ACTIONS.clear: {
        const count = this.clear(action.all);
        const message = action.all
          ? `Cleared ${count} quests`
          : `Cleared ${count} completed quests`;

        return { success: true, message };
      }
      case QUEST_ACTIONS.reorder: {
        if (action.id === undefined)
          return { success: false, message: formatIdRequiredError("reorder") };

        if (action.targetId === undefined)
          return { success: false, message: formatTargetIdRequiredError() };

        const q = this.reorder(action.id, action.targetId);
        if (!q) return { success: false, message: formatReorderNotFoundError() };

        return { success: true, message: `Reordered quest [${q.id}]: ${q.description}`, quest: q };
      }
      case QUEST_ACTIONS.split:
      case QUEST_ACTIONS.add_step: {
        if (action.id === undefined) {
          return { success: false, message: formatIdRequiredError("split") };
        }
        if (!action.descriptions || action.descriptions.length === 0) {
          return { success: false, message: formatMissingDescriptionsError("split") };
        }
        if (action.descriptions.some((d) => !d || d.trim().length === 0)) {
          return { success: false, message: formatEmptyDescriptionsError() };
        }
        try {
          const steps = this.split(action.id, action.descriptions);
          return {
            success: true,
            message: `Split quest [${action.id}] into ${steps.length} steps`,
          };
        } catch (err) {
          return {
            success: false,
            message: `Error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
      case QUEST_ACTIONS.reparent: {
        if (action.id === undefined)
          return { success: false, message: formatIdRequiredError("reparent") };
        try {
          const q = this.reparent(action.id, action.parentId);
          if (!q) return { success: false, message: formatNotFound(action.id) };
          return { success: true, message: formatReparentResult(q, action.parentId), quest: q };
        } catch (err) {
          return {
            success: false,
            message: `Error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
      case QUEST_ACTIONS.rules:
      case QUEST_ACTIONS.skill: {
        return { success: true, message: getQuestSkillDocument() };
      }
      case QUEST_ACTIONS.undo: {
        return this.undo();
      }
      case QUEST_ACTIONS.redo: {
        return this.redo();
      }
      default: {
        return {
          success: false,
          message: formatUnknownActionError((action as { type: string }).type),
        };
      }
    }
  }

  reconstructFromSession(ctx: ExtensionContext): void {
    const branch = ctx.sessionManager.getBranch();
    let lastState: Record<string, unknown> | undefined;
    let toolResults = 0;

    for (const entry of branch) {
      if (
        entry.type === "message" &&
        "message" in entry &&
        entry.message.role === "toolResult" &&
        entry.message.toolName === "quest"
      ) {
        toolResults++;
        lastState = entry.message.details;
      }
    }

    if (lastState) {
      const quests = lastState.quests;
      const questCount = Array.isArray(quests) ? quests.length : 0;

      if (Array.isArray(quests)) {
        this.quests = (quests as Quest[]).filter((q) => !("parentId" in q && q.parentId));
        this.steps = (quests as Quest[]).filter((q) => "parentId" in q && q.parentId) as Step[];
      } else {
        this.quests = [];
        this.steps = [];
      }
      this.usedIds = new Set([...this.quests, ...this.steps].map((q) => q.id));
      logger.debug("quests:state", "reconstruct", { toolResults, questCount });
    } else {
      this.quests = [];
      this.steps = [];
      this.usedIds.clear();
      logger.debug("quests:state", "reconstruct-empty", { toolResults });
    }

    this.history = [];
  }
}

export function makeToolResult(
  text: string,
  questLog: QuestLog,
  displayQuests?: Quest[],
  snapshotQuests?: Quest[],
): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    details: {
      quests: questLog.getAll(),
      usedIds: questLog.getUsedIds(),
      displayQuests,
      snapshotQuests,
    },
  };
}
