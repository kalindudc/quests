# Audit

> See also: [Quests in bb](bb.md) · [Quests](quests.md)

`scripts/quest-audit.mjs` measures how well bb agents keep their quest logs current. It samples recent bb threads, replays each thread's event log, and reports whether the agent planned with quests, how long it worked without touching the log, and whether it ticked quests off as it went or all at the end. Run it before and after a change to the instructions, the tool results or the note, and compare.

```bash
node scripts/quest-audit.mjs                       # 120 threads from the last 7 days
node scripts/quest-audit.mjs --since 2026-10-18 --until 2026-10-26 --json > audit.json
node scripts/quest-audit.mjs --logs ./saved-logs   # rerun on logs saved with --save
```

It needs the `bb` CLI on the path and nothing else; `--help` lists every option. The sample is seeded, so a rerun with the same options picks the same threads, and threads created later do not reshuffle earlier picks.

## What it counts

Work actions are the agent's commands, file reads and edits, image views and tool calls other than the quest tool. A thread is in scope with at least 20 of them.

| Line | Meaning |
|------|---------|
| adoption | In-scope threads whose agent added at least one quest |
| closed mostly at the end | Threads where at least half of the completions came in the last 15% of the work after the first quest |
| silent for half the thread+ | Threads whose longest stretch without a change to the log, while quests were open, covers at least half of the work |
| median longest silent stretch | The median of that stretch, in work actions |
| follow-ups that touched the log | Requests from the user, after the first quest, followed by a quest call within 10 work actions; the call must come after the request |

The same ratios are split into top-level threads and child threads, such as minions, which behave differently: read-only reviewers often skip quests or write a few and close them together.

A toggle counts only its own result lines, such as `Quest [3a] done` or `[3a] done` in a batch, so the plan line that newer results end with is not counted as a completion.

## Baseline

Measured on 2026-10-26 on threads created before the changes that add the plan line to results, the moment-based instructions and the note (`--since 2026-10-18 --until 2026-10-26`, seed 7, 120 threads):

| Measure | Baseline |
|---------|----------|
| adoption | 75 of 85 |
| closed mostly at the end | 41 of 74 |
| silent for half the thread+ | 39 of 75 |
| median longest silent stretch | 36 actions |
| follow-ups that touched the log | 42 of 104 |

The study that led to those changes reported 67 of 106 follow-ups touching the log; that count included quest calls made just before the request, which the script no longer counts.
