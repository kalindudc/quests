# Reference

> See also: [Quests](quests.md) · [Pattern](pattern.md) · [Architecture](architecture.md)

## Quick reference

| Name | Type | Purpose |
|------|------|---------|
| `quest` | Tool | Add, list, toggle, update, delete, clear, reorder, or revert quests |
| `/quests` | Command | User-facing quest commands |
| `Quest shortcut` | Keybinding | Open the interactive quest list (default `ctrl+shift+l`) |
| `Status widget` | UI | Footer progress indicator showing completed/total quests |

## Tool: `quest`

**Schema:**

```typescript
{
  action: "add" | "split" | "add_step" | "reparent" | "list" | "toggle" | "update" | "delete" | "clear" | "reorder" | "revert" | "rules" | "skill",
  descriptions?: string[],
  description?: string,
  id?: string,
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
| `toggle` | `id` | Flips `done` flag for the given quest |
| `update` | `id`, `description` | Changes a quest description |
| `delete` | `id` | Removes a quest |
| `clear` | — | Removes completed quests. Set `all: true` to remove everything. |
| `reorder` | `id`, `targetId` | Moves a quest before the target quest |
| `revert` | — | Reverts the most recent mutating action |
| `reparent` | `id`, `parentId?` | Promotes, demotes, or reparents a quest/step |
| `rules` | — | Returns quest management rules |
| `skill` | — | Alias for `rules` |

**Result shape:**

```typescript
{
  content: [{ type: "text", text: string }],
  details: { quests: Quest[], usedIds: string[] }
}
```

**Result view:**

Tool results follow pi's compact view. A collapsed tool row shows the first 10 lines followed by a `... (N more lines, ctrl+o to expand)` hint; expanding the row (`app.tools.expand`, `ctrl+o` by default) shows the full quest list or document. This applies to quest listings and to plain-text results such as `rules`/`skill`.

## Command: `/quests`

| Subcommand | Usage | Behavior |
|------------|-------|----------|
| `add` | `/quests add <description>` | Add a top-level quest |
| `add-step` | `/quests add-step <id> <description>` | Split a quest into a step |
| `list` | `/quests list` | Open interactive quest list widget |
| `toggle` | `/quests toggle <id>` | Toggle quest completion |
| `update` | `/quests update <id> <description>` | Update description |
| `delete` | `/quests delete <id>` | Delete a quest |
| `clear` | `/quests clear [all]` | Clear completed quests, or optionally all quests |
| `reorder` | `/quests reorder <id> <targetId>` | Reorder a quest before the target quest |
| `revert` | `/quests revert` | Revert last change |
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
