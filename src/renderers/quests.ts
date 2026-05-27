import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Quest, Step } from "../quest/types.js";

export function formatQuestRow(
  theme: Theme,
  q: Quest | Step,
  idLength: number,
  pos?: number,
): string {
  const isStep = "parentId" in q && q.parentId;

  // position test is only relevant for quests, not steps
  const posText = isStep ? "" : pos !== undefined ? `#${pos}` : "";
  const posWidth = visibleWidth(posText);
  const idText = `[${q.id}]`;

  // spacing is added to keep text aligned
  const spacing = " ".repeat(visibleWidth(`${16 ** idLength}`) - posWidth);
  const idStr = `${theme.fg("muted", idText)} ${theme.fg(q.done ? "dim" : "accent", `${posText}`)}${spacing}`;

  // for steps, use a different marker and indent
  const markerNotDone = isStep ? theme.fg("muted", " └── ○ ") : theme.fg("muted", " ○ ");
  const markerDone = isStep ? theme.fg("muted", " └── ✓ ") : theme.fg("success", " ✓ ");
  const marker = q.done ? markerDone : markerNotDone;

  // for steps, use dim text to contrast with the parent quests
  const descColor = q.done || isStep ? "dim" : "text";
  const desc = q.done
    ? theme.fg(descColor, theme.strikethrough(q.description))
    : theme.fg(descColor, q.description);

  const line = `  ${idStr}${marker} ${desc}`;
  return line;
}

export function formatStepSpacerLine(theme: Theme, idLength: number): string {
  const idTextLength = visibleWidth(`${16 ** idLength}`);
  // spacing for `[id](position string)`
  const spacerStr = `${" ".repeat(idTextLength + 2)}${" ".repeat(idTextLength)}`;

  const marker = theme.fg("muted", " │   ");

  return `  ${spacerStr}${marker}`;
}
