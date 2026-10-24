# Pattern

> See also: [Quests](quests.md) · [Reference](reference.md) · [Architecture](architecture.md)

## Add a quest

**Via command:**

```bash
/quests add Refactor auth middleware
```

**Via tool:**

```json
{ "action": "add", "descriptions": ["Refactor auth middleware"] }
```

**Batch via tool:**

```json
{ "action": "add", "descriptions": ["Task A", "Task B", "Task C"] }
```

## Split a quest into steps

**Via command:**

```bash
/quests add-step 0a Write unit tests
```

**Via tool:**

```json
{ "action": "split", "id": "0a", "descriptions": ["Write unit tests"] }
```

The `add_step` tool action is an alias for `split`.
**Via tool (alias):**

```json
{ "action": "add_step", "id": "0a", "descriptions": ["Write unit tests"] }
```

## Toggle completion

**Via command:**

```bash
/quests toggle 3f
```

**Via tool:**

```json
{ "action": "toggle", "id": "3f" }
```

## Reorder quests

**Via command:**

```bash
/quests reorder 0a 3f
```

**Via tool:**

```json
{ "action": "reorder", "id": "0a", "targetId": "3f" }
```

## Undo a mistake

If a quest was accidentally toggled, updated, or deleted:

```bash
/quests undo
```

Or via tool:

```json
{ "action": "undo" }
```

Each undo reverts the most recent remaining change, so repeat it to go further back. `redo` replays the last undone change until a new change clears it. In bb, the Quests tab has Undo and Redo buttons for the same history.

## View the quest list interactively

```bash
/quests list
```

Opens a paginated widget showing:
- progress bar
- checked/unchecked quest rows
- indented step rows
- page navigation (`Tab` / `Shift+Tab`)

## Edit an agent's quests in bb

Open the thread's Quests tab, or click the progress chip in the prompt box, and change the log there. The agent's next `quest` call reports your changes; see [Quests in bb](bb.md#the-quests-tab).

## Recover quests after a branch switch

Quest state is automatically reconstructed from the session tree when the branch changes. No manual action is required.

If you need to force a snapshot for later reconstruction, issue a `list` tool call — the result stores the full quest array in the branch.
