import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const packageJsonPath = resolve(__dirname, "../../package.json");
let cachedVersion: string | undefined;

export function getVersion(): string {
  if (cachedVersion === undefined) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    cachedVersion = packageJson.version as string;
  }
  return cachedVersion;
}

export const CHANGELOG_PATH: string = resolve(__dirname, "../../CHANGELOG.md");
