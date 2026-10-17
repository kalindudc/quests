import { describe, expect, it } from "vitest";
import { parseQuestArgs } from "../../../extensions/pi/commands/parse-args.js";
import { QUEST_ACTIONS } from "../../../src/quest/types.js";

describe("parseQuestArgs", () => {
  it("parses version", () => {
    expect(parseQuestArgs("version")).toEqual({ action: "version" });
  });

  it("parses changelog", () => {
    expect(parseQuestArgs("changelog")).toEqual({ action: "changelog" });
  });

  it("parses help", () => {
    expect(parseQuestArgs("help")).toEqual({ action: "help" });
    expect(parseQuestArgs("h")).toEqual({ action: "help" });
  });

  it("parses list", () => {
    expect(parseQuestArgs("list")).toEqual({ action: QUEST_ACTIONS.list });
  });

  it("parses clear", () => {
    expect(parseQuestArgs("clear")).toEqual({ action: QUEST_ACTIONS.clear, all: false });
  });

  it("parses add with description", () => {
    expect(parseQuestArgs("add Buy milk")).toEqual({
      action: QUEST_ACTIONS.add,
      descriptions: ["Buy milk"],
    });
  });

  it("returns error for add without description", () => {
    expect(parseQuestArgs("add")).toEqual({
      error: "Usage: /quests add <description>",
    });
  });

  it("parses add-step with id and description", () => {
    expect(parseQuestArgs("add-step 01 Sub task")).toEqual({
      action: QUEST_ACTIONS.split,
      id: "01",
      descriptions: ["Sub task"],
    });
  });

  it("parses toggle with one id", () => {
    expect(parseQuestArgs("toggle 03")).toEqual({ action: QUEST_ACTIONS.toggle, ids: ["03"] });
  });

  it("parses toggle with multiple ids", () => {
    expect(parseQuestArgs("toggle 03 0a 0f")).toEqual({
      action: QUEST_ACTIONS.toggle,
      ids: ["03", "0a", "0f"],
    });
  });

  it("returns error for toggle without id", () => {
    expect(parseQuestArgs("toggle")).toEqual({
      error: "Usage: /quests toggle <id> [moreIds...]",
    });
  });

  it("returns error for toggle with invalid id", () => {
    expect(parseQuestArgs("toggle abc")).toEqual({
      error: "Usage: /quests toggle <id> [moreIds...]",
    });
  });

  it("parses undo", () => {
    expect(parseQuestArgs("undo")).toEqual({ action: QUEST_ACTIONS.undo });
  });

  it("parses redo", () => {
    expect(parseQuestArgs("redo")).toEqual({ action: QUEST_ACTIONS.redo });
  });

  it("parses update with id and description", () => {
    expect(parseQuestArgs("update 03 New desc")).toEqual({
      action: QUEST_ACTIONS.update,
      id: "03",
      description: "New desc",
    });
  });

  it("returns error for update without id", () => {
    expect(parseQuestArgs("update")).toEqual({
      error: "Usage: /quests update <id> <description>",
    });
  });

  it("returns error for update without description", () => {
    expect(parseQuestArgs("update 01")).toEqual({
      error: "Usage: /quests update <id> <description>",
    });
  });

  it("parses delete with one id", () => {
    expect(parseQuestArgs("delete 03")).toEqual({ action: QUEST_ACTIONS.delete, ids: ["03"] });
  });

  it("parses delete with multiple ids", () => {
    expect(parseQuestArgs("delete 03 0a")).toEqual({
      action: QUEST_ACTIONS.delete,
      ids: ["03", "0a"],
    });
  });

  it("returns error for delete without id", () => {
    expect(parseQuestArgs("delete")).toEqual({ error: "Usage: /quests delete <id> [moreIds...]" });
  });

  it("returns error for unknown subcommand", () => {
    expect(parseQuestArgs("unknown")).toEqual({
      error: "Unknown subcommand: unknown. Use /quests help to see available commands.",
    });
  });

  it("treats empty args as list", () => {
    expect(parseQuestArgs("")).toEqual({ action: QUEST_ACTIONS.list });
  });

  it("parses reparent with id and optional parentId", () => {
    expect(parseQuestArgs("reparent 02 01")).toEqual({
      action: QUEST_ACTIONS.reparent,
      id: "02",
      parentId: "01",
    });
    expect(parseQuestArgs("reparent 02")).toEqual({ action: QUEST_ACTIONS.reparent, id: "02" });
    expect(parseQuestArgs("reparent")).toEqual({
      error: "Usage: /quests reparent <id> [parentId]",
    });
  });
  it("parses reorder and clear variants", () => {
    expect(parseQuestArgs("reorder 02 01")).toEqual({
      action: QUEST_ACTIONS.reorder,
      id: "02",
      targetId: "01",
    });
    expect(parseQuestArgs("clear all")).toEqual({ action: QUEST_ACTIONS.clear, all: true });
    expect(parseQuestArgs("clear")).toEqual({ action: QUEST_ACTIONS.clear, all: false });
    expect(parseQuestArgs("reorder")).toEqual({ error: "Usage: /quests reorder <id> <targetId>" });
    expect(parseQuestArgs("clear invalid")).toEqual({ error: "Usage: /quests clear [all]" });
  });
});
