import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ResolvedConfig } from "../config.js";
import { logger } from "../logger.js";
import type { QuestLog } from "../quest/dataplane.js";
import { formatQuestRow, formatStepSpacerLine } from "./quests.js";

let activeQuestListWidget: QuestListWidget | undefined;

export function invalidateQuestListWidget(): void {
  activeQuestListWidget?.invalidate();
}

export class QuestListWidget {
  private cachedWidth?: number;
  private cachedLines?: string[];
  private page = 0;

  constructor(
    private questLog: QuestLog,
    private theme: Theme,
    private onClose: () => void,
    private readonly config: ResolvedConfig,
  ) {
    logger.debug("quests:widget", "create", { questCount: questLog.getAll().length });
    activeQuestListWidget = this;
  }

  handleInput(data: string): void {
    logger.debug("quests:widget", "handleInput", { data });
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      logger.debug("quests:widget", "close");
      activeQuestListWidget = undefined;
      this.onClose();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.nextPage();
      return;
    }

    if (matchesKey(data, Key.shift(Key.tab))) {
      this.prevPage();
      return;
    }
  }

  private get totalPages(): number {
    const totalLines = this.buildQuestLines(0).length;
    return Math.max(1, Math.ceil(totalLines / this.config.display.pageSize));
  }

  private buildQuestLines(width: number): string[] {
    const th = this.theme;
    const parents = this.questLog.getQuests();
    const lines: string[] = [];

    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i];
      const steps = this.questLog.getSteps(parent.id);

      const row = formatQuestRow(th, parent, this.config.ids.length, i + 1);
      lines.push(width > 0 ? truncateToWidth(row, width) : row);

      if (steps.length > 0) {
        lines.push(formatStepSpacerLine(th, this.config.ids.length));

        for (const step of steps) {
          const stepRow = formatQuestRow(th, step, this.config.ids.length);
          lines.push(width > 0 ? truncateToWidth(stepRow, width) : stepRow);
        }

        lines.push("");
      }
    }

    return lines;
  }

  private nextPage(): void {
    const next = (this.page + 1) % this.totalPages;
    logger.debug("quests:widget", "nextPage", {
      from: this.page,
      to: next,
      totalPages: this.totalPages,
    });

    this.page = next;
    this.invalidate();
  }

  private prevPage(): void {
    const prev = (this.page - 1 + this.totalPages) % this.totalPages;
    logger.debug("quests:widget", "prevPage", {
      from: this.page,
      to: prev,
      totalPages: this.totalPages,
    });

    this.page = prev;
    this.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) {
      return this.cachedLines;
    }
    logger.debug("quests:widget", "render", {
      width,
      page: this.page,
      totalPages: this.totalPages,
      totalQuests: this.questLog.getAll().length,
    });

    const th = this.theme;
    const lines: string[] = [];
    const allQuests = this.questLog.getAll();
    const total = allQuests.length;
    const doneCount = allQuests.filter((q) => q.done).length;

    // Top accent border
    lines.push(th.fg("accent", "─".repeat(width)));

    // Header with title and completion stats
    const title = th.fg("accent", th.bold("  Quest Log "));
    const stats = total > 0 ? th.fg("muted", `${doneCount}/${total} completed  `) : "";
    const headerGap = Math.max(0, width - visibleWidth(title) - visibleWidth(stats));
    lines.push(truncateToWidth(title + " ".repeat(headerGap) + stats, width));

    lines.push("");

    if (total === 0) {
      lines.push(
        truncateToWidth(
          `  ${th.fg("dim", "No active quests. Add one with /quests add <description>")}`,
          width,
        ),
      );
    } else {
      // Mini progress bar
      const barWidth = Math.min(width - 4, this.config.display.progressBarMaxWidth);
      const filled = Math.round((doneCount / total) * barWidth);
      const empty = barWidth - filled;
      const bar = th.fg("success", "▰".repeat(filled)) + th.fg("dim", "▱".repeat(empty));

      lines.push(truncateToWidth(`  ${bar}  ${th.fg("muted", `${doneCount}/${total}`)}`, width));
      lines.push("");

      const questLines = this.buildQuestLines(width);
      const start = this.page * this.config.display.pageSize;
      const pageLines = questLines.slice(start, start + this.config.display.pageSize);

      lines.push(...pageLines);

      if (this.totalPages > 1) {
        const pageInfo = `  Page ${this.page + 1}/${this.totalPages}  ${th.fg("dim", "· Tab/Shift+Tab to navigate")}`;

        lines.push("");
        lines.push(truncateToWidth(pageInfo, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Press q or Esc to close")}`, width));

    // Bottom accent border
    lines.push(th.fg("accent", "─".repeat(width)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    logger.debug("quests:widget", "invalidate");
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
