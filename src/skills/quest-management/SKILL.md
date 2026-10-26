---
name: quest-management
description: Quest management best practices for the quest tool. Use when the user asks about tracking tasks, managing quests, using the quest tool, or when you need guidance on how to structure session work into quests and steps.
---

# Quest Management

Quests are the thread's live plan. They serve three readers:

- You: working memory that survives long contexts, failed turns and steering, and a checklist before you call the work done.
- The user: a live view of your progress in pi's footer or bb's Quests tab, and a way to steer the plan. The user can add, edit, tick and delete quests.
- Other tools: bb plugins such as minions show each thread's progress from it.

All three need a log that is current while the work happens. A log ticked off in one batch at the end serves none of them.

## When to use quests

- Use them for work with several steps or more than one turn, and whenever the user gives you a list of tasks.
- Skip them for a single-pass answer, a quick read-only look, or a one-line fix. A plan that you would create and close in the same message adds nothing.
- Write one quest per deliverable that can be checked ("Add the retry to the queue worker"), not per activity ("Look at code"). Split a big quest into steps.

## Keeping the log current

- Toggle a quest or step done in the same message as your next action. Do not save completions for the end.
- Every change you make returns the progress and the next open item, so you rarely need `list`. A split returns the new step ids.
- Revisit the log at these moments:
  1. The user redirects, steers or adds work: add, update or delete quests to match.
  2. You resume after an error, an interruption or a long gap: check what is open before you continue.
  3. A minion or delegated thread reports back: toggle what it finished.
  4. Before your final answer: tick what you finished and say what is still open.
- When the plan changes, change the log. Delete quests you will not do, rather than leaving them open.
- If the user changed the log, the next result starts with `The user changed the quest log:`. Treat those edits as instructions.

## Action reference

| Action | Required params | Behavior |
|--------|----------------|----------|
| `add` | `descriptions[]` | Create top-level quests. Batch several descriptions in one call. |
| `split` | `id`, `descriptions[]` | Break a quest into steps under it and return their ids. Alias: `add_step`. |
| `list` | — | View all quests and steps. |
| `toggle` | `id` or `ids[]` | Flip done status. Blocked while a parent has open steps. |
| `update` | `id`, `description` | Change a description. |
| `delete` | `id` or `ids[]` | Remove quests. Blocked while a parent has open steps; deleting a done parent deletes its done steps. |
| `clear` | — | Remove completed quests. `all: true` removes everything. |
| `reorder` | `id`, `targetId` | Move a top-level quest before `targetId`. Steps cannot be reordered. |
| `reparent` | `id`, `parentId?` | Demote to a step under `parentId`, or promote to top-level when `parentId` is omitted. |
| `undo` | — | Undo the most recent change. Repeat to go further back. |
| `redo` | — | Redo the most recently undone change. |
| `rules` / `skill` | — | Return this document. |

## Workflows

### Multi-step task
1. `add` the top-level quests for the goal.
2. `split` the big ones into steps; the result gives each step's id.
3. Work through the steps, toggling each as you finish it.
4. Toggle the parent once all its steps are done and the quest itself is complete.

### Delegation
1. `add` a quest for the delegated work.
2. Start the minion with the task.
3. When it reports back, toggle the quest, or add follow-up quests for what it left open.

### Cleanup
- `clear` completed quests before starting unrelated work, so the log stays focused.

## Rules

- Only top-level quests can have steps.
- A parent can be toggled done only after all its steps are done, and deleted only when none of its steps is open.
- Use `toggle` for done states. Never append "DONE" or another marker with `update`.
- Use the hex ids shown in brackets, never the positional numbers.
- Use `undo` to reverse a mistake and `redo` to replay it; a new change clears the redo history.
