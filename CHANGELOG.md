# pi-quests Changelog

## [Unreleased]

- feat: quests in bb threads for every provider, with per-thread state, a Quests tab and a progress chip; plain pi and Herdr are unchanged
- fix: the pi system prompt told agents that had quests that there were none, and gave an empty log only a weak nudge
- fix: a pi session saved by pi-quests 0.1 to 0.3 starts with an empty quest log and a notice, instead of loading quests whose numeric ids no tool or command could address
- chore: reorganize the repository as one package that is both the pi package and the bb plugin: the quest engine stays in `src/`, the pi extension moves to `extensions/pi/`, the bb plugin lives in `extensions/bb/`, and tests mirror them in `test/core/`, `test/pi/` and `test/bb/`; the stale `pnpm-lock.yaml` is gone, as the repository uses npm only
- chore: the repository moved to github.com/kalindudc/quests; the npm package is still pi-quests, and the old URL redirects

## [0.9.0] - 2026-09-17

- feat: quest tool results follow pi's compact view — collapsed rows show a 10-line preview with a `ctrl+o` (`app.tools.expand`) hint, expanded rows show everything
- fix: RangeError crash when position labels exceed the reserved column width in `formatQuestRow`
- fix: wrap batch add and split in a `runTransaction` guard to roll back partial state on ID exhaustion

## [0.8.0] - 2026-05-26

- feat: migrate to `@earendil-works`
- feat: remove the nudge-based acknowledgement system

## [0.7.0] - 2026-04-26

- feat: add batch toggle and batch delete support for quests (#2) — @pascal-de-ladurantaye
- feat: add redo action and rename revert to undo
- chore: migrate from taskfile to npm scripts and update dependencies

## [0.6.2] - 2026-04-17

- fix: system prompt was too weak
- chore: add more roadmap items

## [0.6.1] - 2026-04-17

- fix: make quest prompt injection static and cache-friendly with `nudges.enable` and `display.showStatus` toggles

## [0.6.0] - 2026-04-17

- feat: add footer quest progress indicator with configurable icon
- fix: quest list widget cache invalidation

## [0.5.1] - 2026-04-17

- fix: add context signals and calibrate nudge thresholds

## [0.5.0] - 2026-04-14

- feat: add reparent action to promote, demote, or move quests and steps with validation and revert support
- feat: add rules and skill actions that return the built-in quest-management skill document
- feat: add split action to break a quest into steps with add_step alias and command support
- feat: rename sub-quest terminology to step across types, commands, docs, and prompts
- feat: improve error messages with actionable recovery hints and refine nudge behavior

## [0.4.0] - 2026-04-13

- feat: add configurable shortcut to open quest list, default: `ctrl+shift+l`
- feat: add sub-quest support with lifecycle management
- feat: add user-configurable settings via pi settings files
- feat: use random 2-digit hex IDs and targetId-based reorder
- fix: add .pi/setting.json for development

## [0.3.0] - 2026-04-11

- feat: add reorder action to move quests by position (dataplane, tool, /quests command, renderer, revert support)
- feat: extend clear action with optional all flag to remove all quests regardless of done state
- feat: detect appended completion markers (e.g. "- DONE") and inject correction nudge via context hook
- feat: update list rendering to show 1-based positions instead of raw IDs
- fix: inline type imports across test files to comply with no-inline-imports rule
- chore: extract shared prompt strings into prompts.ts to eliminate duplication
- chore: fix release workflow output mapping in create-release job

## [0.2.0] - 2026-04-11

- feat: add dynamic quest usage nudges via context hook
- feat: inject quest management reminders into system prompt
- feat: render targeted quest results and add parameter descriptions
- chore: add npm release flow
- chore: refactor codebase for improved maintainability

## [0.1.0] - 2026-04-10

- feat: add session-scoped quest log with tools, commands, and TUI widgets
  - add `QuestLog` with history stack, revert, and session reconstruction
  - expose `quest` tool with add, list, toggle, update, delete, clear, and revert
  - add `/quests` command namespace with interactive list widget and pagination
  - split renderers into dedicated tools, commands, and changelog modules
  - include `AGENTS.md` and concise docs for architecture, patterns, and reference
- chore: setup initial pi extension boilerplate

