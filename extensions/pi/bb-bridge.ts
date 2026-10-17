import { readFileSync } from "node:fs";

/*
 * bb's pi provider writes the tools it bridges into pi to PI_BB_TOOLS_FILE before pi starts.
 * When that list already has `toolName`, bb supplies it and this extension must not register its
 * own copy. An unset, unreadable or malformed file means plain pi.
 */
export function shouldStepAside(
  toolName: string,
  toolsFile: string | undefined = process.env.PI_BB_TOOLS_FILE,
): boolean {
  if (!toolsFile) return false;
  let tools: unknown;
  try {
    tools = JSON.parse(readFileSync(toolsFile, "utf-8"));
  } catch {
    return false;
  }
  return (
    Array.isArray(tools) &&
    tools.some(
      (tool) =>
        typeof tool === "object" && tool !== null && (tool as { name?: unknown }).name === toolName,
    )
  );
}
