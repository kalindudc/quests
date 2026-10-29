# pi-quests Changelog

## [Unreleased]

## [0.11.1] - 2026-10-29

- fix(bb): quest row controls no longer reserve blank space while hidden; their space expands on hover or keyboard focus, with controls always visible on touch screens and animation disabled for reduced motion

## [0.11.0] - 2026-10-26

- feat: every change the agent makes returns the plan's progress and the next open item, and a split returns the new step ids, so the agent rarely needs a `list` call to keep going
- feat: the quest instructions, shared by bb and pi, now say what quests are for, when to skip them, and the moments to revisit the log: the user redirects, a resume after an error, a minion's report and the final answer; the quest-management skill says the same in full
- feat(bb): when a person's request starts a turn on a thread whose open quests went unchanged through the previous request, or whose Quests tab has edits the agent has not seen, the plugin steers one short agent-only note into the turn while one of the agent's tools is running, so the note joins a model call the agent makes anyway; it skips the note once the agent calls the quest tool, sends it once per stale stretch and only on providers that take a steer (pi, Claude Code, Codex), and a `message.dispatch` hook refuses a note that would start a turn
- feat(bb): quests join bb's context row above the composer, beside the parent thread, pull requests and changed files; the segment starts collapsed, shows the progress and the next item, warns when a working agent has left its quests unchanged for 10 minutes, and expands to tick, add and open the Quests tab
- feat(bb): a reworked Quests tab that marks the next item, folds done quests away, shows row controls on hover, says when the agent last changed the log, and lists the edits the agent has not seen with a Tell it now button while it works
- feat(bb): a Quests row in the thread Info tab, an "Add as a quest" item in the send menu that puts the draft on the log without interrupting the agent, and an "Open the Quests tab" command on ⌘⇧L
- feat(pi): a stale log gets the same note attached to the user's prompt, so it costs no extra model call; the extension no longer rewrites the system prompt each run, which kept the prompt cache warm only until the log first changed, and no longer tells an agent with an empty log to "DO THIS NOW and acknowledge it"
- feat: `scripts/quest-audit.mjs` samples recent bb threads and measures how well agents keep their quest logs current; see [the audit](docs/audit.md)
- docs: a guide to the bb plugin (`docs/bb.md`) with screenshots; the README presents the quest log for both bb and pi, and the reference and patterns document `undo` and `redo` instead of the removed `revert`
- docs: the quest-management skill, which bb gives every provider, no longer calls itself a pi extension and no longer says undo goes back only one step
- chore(bb): the plugin needs bb 0.47 and plugin SDK 0.6.79; the Quests tab registers through `experimental_tab`, reads go through bb's tagged query cache instead of the `quests` realtime channel, and the composer's progress chip is gone
- chore: CI runs on Node 22, because the pi packages need Node 22.19 or later and the tests failed on Node 20

## [0.10.0] - 2026-10-18

- feat: quests in bb threads for every provider, with per-thread state, a Quests tab and a progress chip in the prompt box that summarizes open quests on hover; plain pi and Herdr are unchanged
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

