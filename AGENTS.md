# AGENTS

pi-quests shares a pi-free quest engine between its pi extension and bb plugin. Plain pi keeps its `quest` tool and `/quests` command; bb offers a thread panel, a progress chip and a provider-independent quest tool.

## Layout

The repository is one package. Its root `package.json` is both the pi package (the `pi` manifest) and the bb plugin (the `bb` manifest), with one `tsconfig.json`, one `biome.json` and one `package-lock.json`.

| Path | Contents |
|------|----------|
| `src/` | The core engine. It imports only Node built-ins, the root's runtime `dependencies` and other `src/` files. |
| `src/skills/quest-management/SKILL.md` | The one quest skill: pi's `skill` action reads it, and bb loads it through `bb.skills`. A skill lives with the code it describes. |
| `extensions/pi/` | The pi extension. It imports core by relative path. |
| `extensions/bb/` | The bb plugin and its vendored UI (`components/`, `lib/`, `hooks/`, `components.json`). It imports core by relative path (`../../src/quest/...`), which stays inside the plugin because the plugin is the whole repository. |
| `test/` | Tests mirror the source roots: `test/core/` for `src/`, `test/pi/` for `extensions/pi/`, `test/bb/` for `extensions/bb/`, and `test/layout.test.ts`, which enforces these rules. |

The two extensions never import each other, types included. Never add `extensions/bb/index.ts`: without the `pi` manifest, pi would load it as an extension. A new extension gets its own folder under `extensions/`, a test folder under `test/` and a rule in `test/layout.test.ts`.

## Module map

| Module | Purpose |
|--------|---------|
| `src/quest/types.ts` | `Quest`, `QUEST_ACTIONS`, and action value constants |
| `src/quest/formatters.ts` | Pure string formatting for all quest results |
| `src/quest/dataplane.ts` | `QuestLog` — state, history, `execute()`, revert, JSON state |
| `src/quest/defaults.ts` | Pure `ResolvedConfig` and `DEFAULT_CONFIG` |
| `src/quest/progress.ts` | `questProgress`, the done and total counts pi's footer and bb share |
| `src/prompts.ts` | Quest prompt gate and reminders shared by both extensions |
| `src/skills/quest-management/SKILL.md` | The quest skill document |
| `extensions/pi/index.ts` | pi entry point — registers tools, commands, renderers, session hooks |
| `extensions/pi/session.ts` | pi session reconstruction and tool-result shape |
| `extensions/pi/skill.ts` | Reads the core skill document for the `skill` and `rules` actions |
| `extensions/pi/bb-bridge.ts` | Step-aside check for bb's `PI_BB_TOOLS_FILE` |
| `extensions/pi/config.ts` | pi settings loader |
| `extensions/pi/tools/params.ts` | `quest` tool Typebox parameter schema |
| `extensions/pi/tools/handler.ts` | `quest` tool implementation (`questToolExecute`, `registerQuestTool`) |
| `extensions/pi/commands/parse-args.ts` | `/quests` argument tokenizer and parser |
| `extensions/pi/commands/changelog.ts` | `reverseChangelog` helper |
| `extensions/pi/commands/handler.ts` | `/quests` command dispatcher |
| `extensions/pi/renderers/*.ts` | TUI renderers for tools, commands, and changelogs |
| `extensions/pi/logger.ts` | Namespaced debug logging |
| `extensions/bb/server.ts` | bb backend — the `quest` tool, RPC contract and fork handler |
| `extensions/bb/store.ts` | Per-thread quest state in bb thread metadata |
| `extensions/bb/app.tsx` | bb Quests tab and progress chip |

## Development

This project uses **npm** only: `npm ci` installs everything from `package-lock.json`. Do not add a pnpm lockfile: pi can install git packages with pnpm, which would read it instead of the npm lock.

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript check of core, both extensions and the tests (`tsc --noEmit`) |
| `npx vitest run --reporter=json` | Run all unit tests (vitest) |
| `npm run style` | Lint and format check (biome) |
| `npm run style:fix` | Auto-fix biome issues |
| `bb plugin build .` | Build the bb plugin into `dist/` |

The README's Develop section covers testing the checkout in bb and pi while you work.

## Debugging

Debug logs can be found in `tmp/logs/`. If this directory does not exist run `npm run prepare` to bootstrap.

## Writing tests

- Tests mirror their source root: `test/core/` mirrors `src/`, `test/pi/` mirrors `extensions/pi/`, and `test/bb/` mirrors `extensions/bb/`.
- Maintain three tiers:
  1. **Domain unit tests** (`test/core/quest/*.test.ts`) — fast feedback on state mutations and pure functions.
  2. **Adapter unit tests** (`test/pi/commands/*.test.ts`, `test/pi/tools/*.test.ts`, `test/bb/*.test.ts`) — mock the dataplane or host and verify framework-specific adaptation.
  3. **Behavior tests** (`test/pi/behavior.test.ts`) — end-to-end flows through adapter → dataplane → formatter to catch integration drift.
- Prefer directly importing and exercising the unit under test rather than going through higher-level indirection.
- Mock external dependencies narrowly and keep assertions focused on observable outcomes.
- Run the full test suite after behaviour changes; run targeted tests for fast feedback during iteration.

## Definition of done

A change is complete when ALL of the following pass:
1. `npm run typecheck` exits 0
2. `npx vitest run --reporter=json` exits 0 with no failures
3. `npm run style` exits 0
4. Open tests were run after the last code change
5. `bb plugin build .` exits 0 when the change touches `src/` or `extensions/bb/`

## Key conventions

- TypeScript strict (`tsc --noEmit` must pass)
- vitest for unit tests
- Keep documentation concise; one concept per file in `docs/`
- Do not duplicate content across docs — link instead
- Renderers live in `extensions/pi/renderers/`, tools in `extensions/pi/tools/`, commands in `extensions/pi/commands/`
- Extensions depend on core, never on each other; `test/layout.test.ts` enforces it

## Rules

- NEVER Edit `node_modules/` or generated files
- NEVER Skip tests after behavior changes
- NEVER Duplicate documentation across `docs/` files
- NEVER add any inline imports, ALWAYS import types and classes properly if they are being used
