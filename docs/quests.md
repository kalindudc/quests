# Quests

> See also: [Reference](reference.md) · [Pattern](pattern.md) · [Architecture](architecture.md)

## What is a quest?

A **quest** is a lightweight task item with an ID, description, completion flag, and creation timestamp. The agent and user can add, toggle, update, and delete quests throughout a pi session or bb thread.

## What quests are for

Quests are the agent's live plan, and they serve three readers:

- **The agent:** working memory that survives long contexts, failed turns and steering, and a checklist before it calls the work done.
- **You:** a live view of progress, and a way to steer the plan by editing it.
- **Other tools:** bb plugins such as minions show each thread's progress from it.

All three need a log that is current while the work happens, so the tool's results report what is left after every change, and an agent whose open quests went unchanged through a whole request gets one short note at the next one. The [quest-management skill](../src/skills/quest-management/SKILL.md) gives agents the full guidance.

## Quest state

A quest is defined as:

```typescript
interface Quest {
  id: string;
  description: string;
  done: boolean;
  createdAt: number;
}
```

IDs are generated as random hex strings (2 characters by default) and are restored during session reconstruction.

## Steps

A **step** is a quest that belongs to a parent top-level quest. Steps are useful for breaking large tasks into smaller, trackable pieces.

```typescript
interface Step extends Quest {
  parentId: string;
}
```

- Steps are displayed indented beneath their parent quest.
- A parent quest cannot be marked done until all its steps are completed.
- A parent quest cannot be deleted until all its steps are completed (deleting a done parent cascade-deletes its done steps).
- Steps cannot have nested steps of their own.

## History and undo/redo

Every mutating action (`add`, `toggle`, `update`, `delete`, `clear`, `reorder`, `reparent`) pushes a typed `HistoryEntry` onto a stack. Calling `undo` pops the most recent entry and restores the previous state:

- `add` → removes the added quest
- `toggle` → flips the done flag back
- `update` → restores the previous description
- `delete` → reinserts the quest at its original index (restores cascade-deleted steps as well)
- `clear` → restores the full quest array and used IDs
- `reorder` → restores the original quest order and IDs

Calling `redo` replays the most recently undone action. The redo stack is cleared whenever a new mutating action occurs, so you can only redo actions that were undone immediately before a new change.

## Session reconstruction

Because tool results are stored in the session branch, `QuestLog` can reconstruct its entire state by scanning for the latest `quest` tool result. This happens automatically on `session_start` and `session_tree` events.

Reconstruction requires no disk persistence and survives branch switches.

In bb there is no session branch to scan, so the plugin keeps each thread's log in bb's thread metadata instead; see [Quests in bb](bb.md#where-quests-live).
