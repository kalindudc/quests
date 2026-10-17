import type { Theme } from "@earendil-works/pi-coding-agent";
import type { QuestLog } from "../../../src/quest/dataplane.js";
import { questProgress } from "../../../src/quest/progress.js";

export class QuestStatusWidget {
  private readonly key = "pi-quests";
  private readonly barWidth = 5;

  constructor(
    private readonly icon: string,
    private readonly enabled: boolean = true,
  ) {}

  update(
    questLog: QuestLog,
    ui: { setStatus(key: string, text: string | undefined): void },
    theme: Theme,
  ): void {
    if (!this.enabled) return;

    const { done, total } = questProgress(questLog.getAll());

    const text = this.formatStatus(total, done, theme);
    ui.setStatus(this.key, text);
  }

  private formatStatus(total: number, done: number, theme: Theme): string | undefined {
    if (total === 0) {
      return undefined;
    }

    const filled = Math.round((done / total) * this.barWidth);
    const empty = this.barWidth - filled;
    const bar = theme.fg("success", "▰".repeat(filled)) + theme.fg("muted", "▱".repeat(empty));

    return `${theme.fg("accent", this.icon)} ${bar} ${theme.fg("dim", `${done}/${total}`)}`;
  }
}
