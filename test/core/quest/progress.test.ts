import { describe, expect, it } from "vitest";
import { QuestLog } from "../../../src/quest/dataplane.js";
import { questProgress } from "../../../src/quest/progress.js";

describe("questProgress", () => {
  it("is empty for an empty log", () => {
    expect(questProgress(new QuestLog().getAll())).toEqual({ done: 0, total: 0, current: null });
  });

  it("counts quests and steps alike and names the first open top-level quest", () => {
    const log = new QuestLog();
    const [finished, next] = [log.add("Finished"), log.add("Next")];
    const [first] = log.split(next.id, ["First step", "Second step"]);
    log.toggle(finished.id);
    log.toggle(first!.id);

    expect(questProgress(log.getAll())).toEqual({ done: 2, total: 4, current: "Next" });
  });

  it("skips an open step of a finished quest when naming the current quest", () => {
    const log = new QuestLog();
    const parent = log.add("Parent");
    const [step] = log.split(parent.id, ["Step"]);
    log.toggle(step!.id);
    log.toggle(parent.id);
    log.toggle(step!.id);
    log.add("Later");

    expect(questProgress(log.getAll())).toEqual({ done: 1, total: 3, current: "Later" });
  });
});
