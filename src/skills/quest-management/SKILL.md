---
name: quest-management
description: Quest management best practices for the pi-quests extension. Use when the user asks about tracking tasks, managing quests, using the quest tool, or when you need guidance on how to structure session work into quests and steps.
---

# Quest Management

This skill provides guidelines and best practices for using the quest management system in the pi-quests extension. It covers the core actions available for managing quests, recommended workflows for common use cases, and important rules to follow for effective task tracking and progress management.

## Action Reference

| Action | Required Params | Behavior |
|--------|----------------|----------|
| `add` | `descriptions[]` | Create top-level quests. Batch multiple descriptions in one call. |
| `split` | `id`, `descriptions[]` | Break a quest into steps under it. Alias: `add_step`. |
| `list` | — | View all quests and steps. |
| `toggle` | `id` | Flip done status. Blocked if parent has incomplete steps. |
| `update` | `id`, `description` | Change description. |
| `delete` | `id` | Remove a quest. Blocked if parent has incomplete steps. Cascade-deletes done steps of a done parent. |
| `clear` | — | Remove completed quests. `all: true` removes everything. |
| `reorder` | `id`, `targetId` | Move a top-level quest before `targetId`. Steps cannot be reordered. |
| `reparent` | `id`, `parentId?` | Demote to step under `parentId`, or promote to top-level if `parentId` omitted. |
| `undo` | — | Undo the most recent mutating action. One level only. |
| `redo` | — | Redo the most recently undone action. |
| `rules` / `skill` | — | Return this document. |

## Workflows

### Multi-step task
1. `add` top-level quests for the overall goal
2. `split` them into steps for each deliverable
3. Execute steps sequentially, `toggle` each done as you finish
4. `add` other top-level quests for other related work of this goal
4. `toggle` the parent done only after all steps are complete

### Delegation
1. `add` a quest for the delegated task
2. `spawn` the minion and assign the work
3. `toggle` the quest done when the minion returns successfully

### Reparenting
- Promote a step: `reparent <step-id>` (omit `parentId`)
- Demote a quest: `reparent <quest-id> <parent-id>`
- Move a step: `reparent <step-id> <new-parent-id>`

### Cleanup
- `clear` completed quests before adding unrelated work. Keeps the log focused.

## Rules

- ALWAYS use quests for any work that involves multiple turns.
- NEVER try to nest steps. Only top-level quests can be parents.
- NEVER mark a parent as done if they have incomplete steps.
- NEVER delete a quest with incomplete steps.
- Use undo if you make a mistake to undo an action.
- Use redo to replay an action you just undid. Redo is cleared when a new mutation happens.
- ALWAYS use the hex ID, never the positional number when referring to quests in actions.
- ALWAYS Use `toggle` for done states. NEVER use `update` to append "DONE" or any completion marker to a description.
- If a parent toggle is blocked, check that all its steps are done first.
