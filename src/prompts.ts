export const QUEST_PROMPT_REMINDER = [
  "Use the quest tool to track tasks, plans, and progress, alongside your work rather than in turns of its own.",
  "Before reading files or making edits, ensure work is tracked as specific, actionable quests.",
  "Break broad requests into concrete, independent quests. Use split to break quests into steps for multi-step tasks. When the user gives a list of tasks, add them as quests immediately.",
  "Toggle a quest done as soon as you finish it, in the same message as your next action. Do not save completions for the end.",
  "ALWAYS use the toggle action for completion. NEVER append completion markers via update.",
  "A parent quest cannot be toggled done until all its steps are complete.",
  "Always use the hex ID shown in brackets (e.g. 0a, ff) for actions, never the positional number.",
  "When reading a skill file, plan, or protocol with numbered steps, add those steps as quests immediately.",
  "Use the quest tool with action: 'skill' for complete usage documentation, patterns, and best practices.",
] as const;

export const QUEST_PROMPT_GATE =
  "Before reading files, running commands, or making edits, ALWAYS ensure the current work is tracked as specific, actionable quests.\nALWAYS breakdown broad quests into smaller steps.";
