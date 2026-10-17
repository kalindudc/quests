import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Quest, Step } from "../../../src/quest/types.js";

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

  // Reserve width for the widest position label ("#" + up to `16 ** idLength`)
  // and clamp so an unexpectedly wide label can never crash the renderer.
  const posColWidth = visibleWidth(`#${16 ** idLength}`);
  const spacing = " ".repeat(Math.max(0, posColWidth - posWidth));
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
  const posColWidth = visibleWidth(`#${16 ** idLength}`);
  // spacing for `[id](position string)`
  const spacerStr = `${" ".repeat(idTextLength + 2)}${" ".repeat(posColWidth)}`;

  const marker = theme.fg("muted", " │   ");

  return `  ${spacerStr}${marker}`;
}
