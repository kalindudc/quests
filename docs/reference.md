# Reference

> See also: [Quests](quests.md) · [Pattern](pattern.md) · [Architecture](architecture.md)

## Quick reference

| Name | Type | Purpose |
|------|------|---------|
| `quest` | Tool | Add, list, toggle, update, delete, clear, reorder, reparent, undo, or redo quests (pi and bb) |
| `/quests` | Command | User-facing quest commands (pi) |
| `Quest shortcut` | Keybinding | Open the interactive quest list (pi, default `ctrl+shift+l`) |
| `Status widget` | UI | Footer progress indicator showing completed/total quests (pi) |
| Quests tab | UI | View and edit the thread's quests in the side panel ([bb](bb.md#the-quests-tab)) |
| Progress chip | UI | Done and total counts in the prompt box, open quests on hover ([bb](bb.md#the-progress-chip)) |

## Tool: `quest`

**Schema:**

```typescript
{
  action: "add" | "split" | "add_step" | "reparent" | "list" | "toggle" | "update" | "delete" | "clear" | "reorder" | "undo" | "redo" | "rules" | "skill",
  descriptions?: string[],
  description?: string,
  id?: string,
  ids?: string[],
  targetId?: string,
  parentId?: string,
  all?: boolean
}
```

| Action | Required params | Behavior |
|--------|----------------|----------|
| `add` | `descriptions[]` | Adds one or many top-level quests (required). |
| `split` | `id`, `descriptions[]` | Breaks a quest into steps under it. |
| `add_step` | `id`, `descriptions[]` | Alias for `split`. |
| `list` | — | Returns all quests as plain text |
| `toggle` | `id` or `ids[]` | Flips the `done` flag of one or more quests |
| `update` | `id`, `description` | Changes a quest description |
| `delete` | `id` or `ids[]` | Removes one or more quests |
| `clear` | — | Removes completed quests. Set `all: true` to remove everything. |
| `reorder` | `id`, `targetId` | Moves a quest before the target quest |
| `undo` | — | Undoes the most recent mutating action; repeat to go further back |
| `redo` | — | Redoes the most recently undone action |
| `reparent` | `id`, `parentId?` | Promotes, demotes, or reparents a quest/step |
| `rules` | — | Returns quest management rules |
| `skill` | — | Alias for `rules` |

**Result shape in pi:**

```typescript
{
  content: [{ type: "text", text: string }],
  details: { quests: Quest[], usedIds: string[] }
}
```

In bb the tool returns the same text without `details`, because bb keeps the log in thread metadata; see [Quests in bb](bb.md).

**Result text:**

A successful change ends with one line for the plan, so the agent can carry on without a `list` call. A split lists the new step ids:

```
Split quest [3a] into 2 steps:
[55]: Live data on bb's query cache
[54]: Refusals and toasts
0 of 3 done. Next: [55] Live data on bb's query cache (a step of [3a])
```

The line names the first open step of the first open quest, or the quest itself once its steps are done, and reads `Every quest is done.` when nothing is open. `list`, `rules`, `skill` and failed actions return their text unchanged.

**Result view in pi:**

Tool results follow pi's compact view. A collapsed tool row shows the first 10 lines followed by a `... (N more lines, ctrl+o to expand)` hint; expanding the row (`app.tools.expand`, `ctrl+o` by default) shows the full quest list or document. This applies to quest listings and to plain-text results such as `rules`/`skill`.

## Command: `/quests`

pi only. In bb, use the [Quests tab](bb.md#the-quests-tab).

| Subcommand | Usage | Behavior |
|------------|-------|----------|
| `add` | `/quests add <description>` | Add a top-level quest |
| `add-step` | `/quests add-step <id> <description>` | Split a quest into a step |
| `list` | `/quests list` | Open interactive quest list widget |
| `toggle` | `/quests toggle <id> [moreIds...]` | Toggle one or more quests |
| `update` | `/quests update <id> <description>` | Update description |
| `delete` | `/quests delete <id> [moreIds...]` | Delete one or more quests |
| `clear` | `/quests clear [all]` | Clear completed quests, or optionally all quests |
| `reorder` | `/quests reorder <id> <targetId>` | Reorder a quest before the target quest |
| `undo` | `/quests undo` | Undo the last change |
| `redo` | `/quests redo` | Redo the last undone change |
| `reparent` | `/quests reparent <id> [parentId]` | Reparent a quest/step |
| `version` | `/quests version` | Show extension version |
| `changelog` | `/quests changelog` | Show reversed changelog |
| `help` | `/quests help` | Show subcommand list |

Omitting the subcommand defaults to `list`.

## Footer status widget

A compact progress bar appears in the footer whenever quests exist. It shows:
- a configurable icon (default `󰣏`)
- a 5-character progress bar
- the completion count (e.g. `6/10`)

The widget updates automatically when quests change via tools, commands, or session reconstruction. When no quests remain, the footer status is hidden.

## Widget shortcuts

When viewing the quest list:

- `q` / `Esc` — close widget
- `Tab` — next page
- `Shift+Tab` — previous page
