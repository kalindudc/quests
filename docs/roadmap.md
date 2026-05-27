## Road to v1.0.0

### core
- [x] initial boilerplate with `/quests version` and `/quests changelog` commands
- [x] TypeScript + Biome + Vitest toolchain
- [x] Taskfile dev workflow, CI, and release automation
- [x] quest list data model and in-memory session storage
  - `/quests add <description>` command and tool
  - `/quests list` command and tool
  - `/quests done <id>` command and tool
  - `/quests clear` command and tool
- [x] agent prompt guidelines for quest management
- [x] bug: when trying to add a subquest for a subquest, the returned error "not found" is unintuitive and misleading
- [x] improve error messages with recovery hints (`Problem. Rule. Recovery hint.` pattern)
- [x] add `split` action — break one quest into N steps under it
- [x] add `reparent` action — promote/reparent/demote a quest or step via optional `parentId`
- [x] deprecate `sub-quest` naming in favor of `step` across types, methods, and user-facing strings
- [x] add `rules/skill (alias)` action — return a teachable skill document for quest management best practices and general rules of the quest system
- [x] Rename `revert` to `undo`, and add a `redo` action
- [ ] lightweight snapshot capture at quest creation
- [ ] `/quests rollback <id>` command and tool
- [ ] snapshot restoration logic (file state + conversation context)
- [ ] add a quest log reset
- [ ] dynamic quest log resets, to avoid confusion
- [ ] quest log filtering, only show incomplete quests, etc...
- [ ] quest log widget should have more controls
  - `up / down` arrow functionality to navigate through each quest in the log, current selection should be highlighted
  - `t | enter` key should toggle the current selected quest
  - `d` key should delete the current selected quest
  - `r` key should prompt to reparent the current selected quest
  - `/` key should enter search/filter mode (filter by keyword or show incomplete only)
  - `a` key should give a prompt to add a new quest
  - `z` key should revert, `y` key should restore
  - refactor widget from hand-rolled string arrays to `Container` + `SelectList` from `@earendil-works/pi-tui`
- [ ] respect `expanded`/`isPartial` in tool `renderResult` — collapsed summary by default, full tree when expanded; show spinner while partial
- [ ] add `split`/`add_step` call annotations in `renderCall` — show `[id]` and `[n steps]` like other actions
- [ ] improve fallback/error rendering in tool results — themed error boxes instead of raw plain text when `details.quests` is missing
- [ ] register `quest-help` custom message renderer — replace cramped `ctx.ui.notify()` toast with scrollable markdown in the chat log

### observability
- [x] progress indicator for active quest (e.g., 3 of 7 complete)
- [x] bug: quest log widget does not update when new quests are added until a key is pressed
- [x] quest status widget in footer or status line
- [ ] responsive status bar polish — dynamic-width progress bar + preview of next incomplete quest
- [ ] quest history view with timestamps
- [ ] debug logging for snapshot/rollback operations

### config and quality
- [ ] configurable quest persistence (memory-only vs file-backed)
- [ ] max quest limit per session
- [ ] snapshot size limits and exclusions
- [ ] validation gates before rollback (confirm destructive restore)
- [ ] theme audit across all renderers — ensure `changelog`, tool results, and widgets respect the injected `Theme` instead of hardcoded tokens

### nice to have (v1.x.x)
- [ ] quest templates (e.g., "Implement feature", "Refactor module", "Write tests")
- [ ] automatic quest suggestions based on agent intent
- [ ] quest dependencies (block quest B until quest A is done)
- [ ] export quest log as markdown checklist
- [ ] integration with external task trackers (GitHub issues, Linear)

### v1.0.0 and beyond
- [ ] branch-aware quests (quests survive `/fork`)
- [ ] cross-session quest archive
- [ ] collaborative quests across distributed agents
