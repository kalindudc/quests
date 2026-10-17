import { QUEST_ACTIONS } from "../../../src/quest/types.js";
import { logger } from "../logger.js";

export type ParsedArgs =
  | { action: typeof QUEST_ACTIONS.add; descriptions: string[] }
  | { action: typeof QUEST_ACTIONS.split; id: string; descriptions: string[] }
  | { action: typeof QUEST_ACTIONS.list }
  | { action: typeof QUEST_ACTIONS.toggle; ids: string[] }
  | { action: typeof QUEST_ACTIONS.update; id: string; description: string }
  | { action: typeof QUEST_ACTIONS.delete; ids: string[] }
  | { action: typeof QUEST_ACTIONS.clear; all?: boolean }
  | { action: typeof QUEST_ACTIONS.reorder; id: string; targetId: string }
  | { action: typeof QUEST_ACTIONS.undo }
  | { action: typeof QUEST_ACTIONS.redo }
  | { action: typeof QUEST_ACTIONS.reparent; id: string; parentId?: string }
  | { action: "help" }
  | { action: "version" }
  | { action: "changelog" }
  | { error: string };

/**
 * Parse user input from the /quests command into structured arguments.
 */
export function parseQuestArgs(args: string, idLength = 2): ParsedArgs {
  logger.debug("quests:cmd", "parse-args", { args });
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  // Empty input defaults to listing quests.
  if (tokens.length === 0) {
    logger.debug("quests:cmd", "parse-args-empty", { action: QUEST_ACTIONS.list });
    return { action: QUEST_ACTIONS.list };
  }

  const [command, ...rest] = tokens;

  // Meta commands
  if (command === "version") return { action: "version" };
  if (command === "changelog") return { action: "changelog" };
  if (command === "help" || command === "h") return { action: "help" };

  // Quest actions without arguments
  if (command === QUEST_ACTIONS.list) return { action: QUEST_ACTIONS.list };
  if (command === QUEST_ACTIONS.clear) return parseClearArgs(rest);
  if (command === QUEST_ACTIONS.undo) return { action: QUEST_ACTIONS.undo };
  if (command === QUEST_ACTIONS.redo) return { action: QUEST_ACTIONS.redo };

  // Quest actions with arguments
  if (command === QUEST_ACTIONS.add) return parseAddArgs(rest);
  if (command === "add-step") return parseAddStepArgs(rest, idLength);
  if (command === QUEST_ACTIONS.toggle) return parseToggleArgs(rest, idLength);
  if (command === QUEST_ACTIONS.delete) return parseDeleteArgs(rest, idLength);
  if (command === QUEST_ACTIONS.update) return parseUpdateArgs(rest, idLength);
  if (command === QUEST_ACTIONS.reorder) return parseReorderArgs(rest, idLength);
  if (command === QUEST_ACTIONS.reparent) return parseReparentArgs(rest, idLength);

  return { error: `Unknown subcommand: ${command}. Use /quests help to see available commands.` };
}

function parseAddArgs(tokens: string[]): ParsedArgs {
  const description = tokens.join(" ").trim();
  if (!description) return { error: "Usage: /quests add <description>" };

  return { action: QUEST_ACTIONS.add, descriptions: [description] };
}

function parseAddStepArgs(tokens: string[], idLength: number): ParsedArgs {
  const id = tokens[0] ? tokens[0].toLowerCase() : "";
  const pattern = new RegExp(`^[0-9a-f]{${idLength}}$`);
  if (!pattern.test(id)) return { error: "Usage: /quests add-step <id> <description>" };
  const description = tokens.slice(1).join(" ").trim();
  if (!description) return { error: "Usage: /quests add-step <id> <description>" };
  return { action: QUEST_ACTIONS.split, id, descriptions: [description] };
}

function parseToggleArgs(tokens: string[], idLength: number): ParsedArgs {
  const pattern = new RegExp(`^[0-9a-f]{${idLength}}$`);
  const ids = tokens.map((token) => token.toLowerCase());

  if (ids.length === 0 || ids.some((id) => !pattern.test(id))) {
    return { error: "Usage: /quests toggle <id> [moreIds...]" };
  }

  return { action: QUEST_ACTIONS.toggle, ids };
}

function parseDeleteArgs(tokens: string[], idLength: number): ParsedArgs {
  const pattern = new RegExp(`^[0-9a-f]{${idLength}}$`);
  const ids = tokens.map((token) => token.toLowerCase());

  if (ids.length === 0 || ids.some((id) => !pattern.test(id))) {
    return { error: "Usage: /quests delete <id> [moreIds...]" };
  }

  return { action: QUEST_ACTIONS.delete, ids };
}

function parseUpdateArgs(tokens: string[], idLength: number): ParsedArgs {
  const id = tokens[0] ? tokens[0].toLowerCase() : "";
  const pattern = new RegExp(`^[0-9a-f]{${idLength}}$`);
  if (!pattern.test(id)) return { error: "Usage: /quests update <id> <description>" };

  const description = tokens.slice(1).join(" ").trim();
  if (!description) return { error: "Usage: /quests update <id> <description>" };

  return { action: QUEST_ACTIONS.update, id, description };
}

function parseClearArgs(tokens: string[]): ParsedArgs {
  const all = tokens[0] === "all";
  if (tokens.length > 0 && !all) return { error: "Usage: /quests clear [all]" };
  return { action: QUEST_ACTIONS.clear, all };
}

function parseReorderArgs(tokens: string[], idLength: number): ParsedArgs {
  const id = tokens[0] ? tokens[0].toLowerCase() : "";
  const targetId = tokens[1] ? tokens[1].toLowerCase() : "";
  const pattern = new RegExp(`^[0-9a-f]{${idLength}}$`);

  if (!pattern.test(id) || !pattern.test(targetId))
    return { error: "Usage: /quests reorder <id> <targetId>" };

  return { action: QUEST_ACTIONS.reorder, id, targetId };
}

function parseReparentArgs(tokens: string[], idLength: number): ParsedArgs {
  const id = tokens[0] ? tokens[0].toLowerCase() : "";
  const pattern = new RegExp(`^[0-9a-f]{${idLength}}$`);
  if (!pattern.test(id)) return { error: "Usage: /quests reparent <id> [parentId]" };

  const parentId = tokens[1] ? tokens[1].toLowerCase() : undefined;
  if (parentId && !pattern.test(parentId))
    return { error: "Usage: /quests reparent <id> [parentId]" };

  return { action: QUEST_ACTIONS.reparent, id, parentId };
}
