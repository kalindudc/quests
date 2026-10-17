import { describe, expect, it } from "vitest";
import { createQuestParams } from "../../../extensions/pi/tools/params.js";
import { QUEST_ACTION_VALUES } from "../../../src/quest/types.js";

describe("QuestParams", () => {
  it("action enum matches QUEST_ACTION_VALUES", () => {
    const params = createQuestParams(2);
    const actionSchema = params.properties.action as { enum?: string[] };
    expect(actionSchema.enum).toEqual(QUEST_ACTION_VALUES);
  });

  it("includes ids for batch toggle", () => {
    const params = createQuestParams(2);
    expect(params.properties.ids).toBeDefined();
  });
});
