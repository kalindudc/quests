/**
 * Reverse changelog sections so the newest release appears first.
 */
export function reverseChangelog(content: string): string {
  const parts = content.split(/^## \[/m);
  const preamble = parts[0];
  const sections = parts.slice(1).map((s) => `## [${s}`);
  return [preamble, ...sections.reverse()].join("");
}
