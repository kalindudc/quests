# Quests in bb

> See also: [Reference](reference.md) · [Quests](quests.md) · [Architecture](architecture.md#bb-thread-state)

The bb plugin gives every [bb](https://getbb.app) thread its own quest log. The agent tracks its work with the `quest` tool, and you follow and edit the same log in the thread's Quests tab. The [README](../README.md#in-bb) shows how to install it.

## Every provider gets the same tool

The plugin registers one `quest` tool with bb, and bb hands it to whichever provider runs the thread. The plugin does not depend on pi or on any other provider:

| Provider | How the agent sees the tool |
|----------|-----------------------------|
| pi | A native `quest` tool. The pi-quests extension [steps aside](#pi-threads-in-bb). |
| Claude Code | `mcp__bb-bridge__quest`, through bb's MCP bridge |
| Codex | `quest` on bb's MCP server |
| ACP agents, such as Cursor, opencode or omp | `quest` on the MCP server bb starts for each ACP session |

The tool takes the same actions and parameters as the pi tool; see the [Reference](reference.md#tool-quest). It returns plain text, so every provider shows the same result. bb also adds the tool's short usage rules to the thread's instructions, and ships the `quest-management` skill to every provider; the `skill` and `rules` actions point the agent to that skill.

bb applies tool and instruction changes when a thread starts a new provider session, so a thread that was already running when you installed or updated the plugin picks them up in its next session.

## The Quests tab

![The Quests tab](assets/bb_quests_tab.png)

Open the Quests tab from the thread's side panel, or click the progress chip in the prompt box. The tab shows the thread's quests with their steps indented beneath them, and lets you:

- add a quest, or add a step to a quest with its `+` button;
- tick a quest or step done, or untick it;
- edit a description, or delete a quest after confirming (a quest's steps go with it);
- move a top-level quest up or down;
- undo and redo changes, whether you or the agent made them;
- clear the quests that are done.

Your changes are not hidden from the agent. The next time it calls the `quest` tool, the result starts with a list of what you changed under `The user changed the quest log:`, followed by the normal result.

The tab refreshes as soon as the agent changes the log, so you can keep it open while the thread works.

## The progress chip

![The progress chip with its hover summary](assets/bb_quests_chip.png)

The chip sits in the prompt box's action row, beside voice and send. It shows how many quests and steps are done out of the total, for example `6/11`, and only an icon while the log is empty. Hovering lists up to five open top-level quests with their step counts, and clicking opens the Quests tab.

## Where quests live

Each thread keeps its quests in bb's thread metadata, so they survive bb restarts and do not depend on the provider's session. A forked thread starts with a copy of its source's quests and changes independently afterwards; a side chat starts with an empty log. The history keeps the newest 50 undo and 50 redo steps.

Other plugins can read a thread's progress from the metadata namespace `quests`. The [minions plugin](https://github.com/kalindudc/minions) uses it to show each minion's quest progress. The [Architecture](architecture.md#bb-thread-state) page describes the stored keys and the size limits.

## pi threads in bb

In a bb pi thread, bb passes the plugin's `quest` tool into pi, and the pi-quests extension steps aside so the agent sees one quest tool, not two. That thread therefore has no `/quests` command or pi footer; use the Quests tab and the chip instead. Plain pi, and pi under Herdr, keep the extension.

Run `pi update` before installing the plugin: pi-quests 0.9.0 and earlier do not step aside, and pi refuses to start a bb thread that loads two tools named `quest`.
