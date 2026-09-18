# pi-quests

[![version 0.9.0](https://img.shields.io/badge/version-0.9.0-blue)](CHANGELOG.md)
[![MIT license](https://img.shields.io/badge/license-MIT-green)](LICENSE.md)
[![pi extension](https://img.shields.io/badge/pi-extension-purple)](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)

A quest-log for your [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). Keep your agent on track, one quest at a time.

## Why pi-quests?

Long agent sessions drift. Goals get lost in tool calls, side quests multiply, and the original task is forgotten under a pile of yak hair.

![Quests log in action](docs/assets/quests_log.png)

pi-quests gives your agent a persistent quest log — a living TODO list for the current session. Each quest is a checkpoint the agent can create, complete, and optionally roll back to if things go sideways.

- **Stay focused** — the quest log keeps the original goal visible no matter how deep the rabbit hole goes
- **Checkpoint progress** — mark milestones as quests and capture lightweight session snapshots (WIP)
- **Rollback safety** — revert to a previous quest snapshot when exploration goes off track (WIP)
- **Session-scoped** — quests live with the session, vanish when you start fresh

## Install

```bash
pi install npm:pi-quests
```

## Quick start

```
/quests help

Available /quests subcommands:
  add <description>  - Add a new quest
  list               - List all quests
  toggle <id>        - Toggle quest completion
  delete <id>        - Delete a quest
  update <id> <desc> - Update a quest description
  revert             - Revert the last quest change
  clear              - Clear all quests
  version            - Show version
  changelog          - Show changelog
  h, help            - Show this help message
```

![Quests toggle](docs/assets/quests_toggle.png)
![Quests view](docs/assets/quests_view.png)


## Configuration

pi-quests reads configuration from pi's settings files. Global settings live at `~/.pi/agent/settings.json` and project overrides go in `.pi/settings.json`.

```json
{
  "pi-quests": {
    "ids": { "length": 2 },
    "display": {
      "pageSize": 10,
      "progressBarMaxWidth": 24
    }
  }
}
```

See [docs/configuration.md](docs/configuration.md) for the full options reference.

## Documentation

| Doc | Description |
|-----|-------------|
| [Pattern](docs/pattern.md) | "How do I...?" recipes for common workflows |
| [Quests](docs/quests.md) | What are quests? |
| [Reference](docs/reference.md) | Complete tool and command schemas, types |
| [Configuration](docs/configuration.md) | Settings, overrides, and examples |
| [Architecture](docs/architecture.md) | Module map, data flow diagrams, design decisions |
| [Changelog](CHANGELOG.md) | Version history |

## License

MIT — see [LICENSE.md](LICENSE.md)
