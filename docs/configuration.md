# Configuration

> See also: [Reference](reference.md) · [Quests](quests.md)

pi-quests reads configuration from pi's settings files. Settings are merged: global settings provide defaults, project settings override.

## Settings files

| Location | Scope | Purpose |
|----------|-------|---------|
| `~/.pi/agent/settings.json` | Global | Default settings for all projects |
| `.pi/settings.json` | Project | Override global settings per repository |

The global settings path respects the `PI_CODING_AGENT_DIR` environment variable. If set, global settings are loaded from `$PI_CODING_AGENT_DIR/settings.json` instead.

## Configuration schema

Add a `pi-quests` key to your settings file:

```json
{
  "pi-quests": {
    "ids": {
      "length": 2
    },
    "display": {
      "pageSize": 10,
      "progressBarMaxWidth": 24,
      "icon": "󰣏",
      "showStatus": true
    },
    "shortcuts": {
      "openQuests": "ctrl+shift+q"
    }
  }
}
```

## Options reference

### ids.length

Length of generated quest IDs in hex characters. Affects both the tool schema regex and command parser validation.

| Default | Type | Range |
|---------|------|-------|
| 2 | `number` | 1-4 |

### display.pageSize

Number of quests shown per page in the interactive quest list widget.

| Default | Type | Range |
|---------|------|-------|
| 10 | `number` | 1-50 |

### display.progressBarMaxWidth

Maximum width of the mini progress bar in the quest list widget.

| Default | Type | Range |
|---------|------|-------|
| 24 | `number` | 8-80 |

### display.icon

Icon displayed in the footer status widget. Any string is accepted, including NerdFont glyphs.

| Default | Type |
|---------|------|
| `󰣏` | `string` |

### display.showStatus

Controls whether the quest status widget is rendered in the footer. When `false`, pi-quests never calls `ui.setStatus` — the footer slot stays empty regardless of quest count.

| Default | Type |
|---------|------|
| `true` | `boolean` |

### shortcuts.openQuests

Keyboard shortcut to open the interactive quest list. Default is `ctrl+shift+l`.

| Default | Type |
|---------|------|
| `ctrl+shift+l` | `string` |

## Example configurations

### Longer quest IDs

Useful when you expect more than ~250 quests in a session.

```json
{
  "pi-quests": {
    "ids": {
      "length": 3
    }
  }
}
```

### Larger quest list widget

```json
{
  "pi-quests": {
    "display": {
      "pageSize": 20,
      "progressBarMaxWidth": 40
    }
  }
}
```

### Custom shortcut

```json
{
  "pi-quests": {
    "shortcuts": {
      "openQuests": "ctrl+shift+q"
    }
  }
}
```

### Full customization

```json
{
  "pi-quests": {
    "ids": {
      "length": 2
    },
    "display": {
      "pageSize": 15,
      "progressBarMaxWidth": 32,
      "icon": "󰣏",
      "showStatus": true
    },
    "shortcuts": {
      "openQuests": "ctrl+shift+q"
    }
  }
}
```
