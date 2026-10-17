import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const REPO_PACKAGES: string[] = [manifest.name];
const RUNTIME_DEPENDENCIES = Object.keys(manifest.dependencies ?? {});
// The packages pi supplies to its extensions; bb installs only `dependencies`, so never these.
const PI_HOST_PACKAGES = Object.keys(manifest.peerDependencies ?? {});

type Import = { file: string; specifier: string; target: string | null };

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  const files: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") visit(child);
      } else if (keep(entry.name)) {
        files.push(relative(ROOT, child));
      }
    }
  };
  visit(join(ROOT, dir));
  return files;
}

/** Every import under `dir`, type-only ones included; `target` is set for relative imports. */
function importsUnder(dir: string): Import[] {
  return filesUnder(dir, (name) => SOURCE_FILE.test(name)).flatMap((file) =>
    ts
      .preProcessFile(readFileSync(join(ROOT, file), "utf-8"), true, true)
      .importedFiles.map(({ fileName }) => ({
        file,
        specifier: fileName,
        target: fileName.startsWith(".")
          ? relative(ROOT, resolve(ROOT, dirname(file), fileName))
          : null,
      })),
  );
}

function inside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

function packageOf(specifier: string): string {
  const [first = "", second = ""] = specifier.split("/");
  return specifier.startsWith("@") ? `${first}/${second}` : first;
}

// Core runs in pi and in bb, so it may use only what both install: Node and `dependencies`.
function breaksCoreRule({ specifier, target }: Import): boolean {
  if (target !== null) return !inside(target, "src");
  return !isBuiltin(specifier) && !RUNTIME_DEPENDENCIES.includes(packageOf(specifier));
}

// The extensions reach core by relative path and never each other, types included.
function breaksPiRule({ specifier, target }: Import): boolean {
  if (target !== null) return !inside(target, "extensions/pi") && !inside(target, "src");
  return specifier.startsWith("@get-bb/") || REPO_PACKAGES.includes(packageOf(specifier));
}

function breaksBbRule({ specifier, target }: Import): boolean {
  if (target !== null) return !inside(target, "extensions/bb") && !inside(target, "src");
  const name = packageOf(specifier);
  return (
    specifier.startsWith("@earendil-works/") ||
    PI_HOST_PACKAGES.includes(name) ||
    REPO_PACKAGES.includes(name)
  );
}

function describeImport({ file, specifier }: Import): string {
  return `${file} imports ${specifier}`;
}

function frontMatterName(skillFile: string): string | undefined {
  return /^---\n[\s\S]*?^name:\s*(\S+)\s*$/m.exec(readFileSync(skillFile, "utf-8"))?.[1];
}

describe("repository layout", () => {
  it("keeps one package: the root manifest, without workspaces or nested manifests", () => {
    const nested = ["src", "extensions", "test"].flatMap((dir) =>
      filesUnder(dir, (name) => name === "package.json"),
    );

    expect(manifest.workspaces).toBeUndefined();
    expect(nested).toEqual([]);
  });

  it("keeps the core engine on Node built-ins, its runtime dependencies and other src/ files", () => {
    expect(importsUnder("src").filter(breaksCoreRule).map(describeImport)).toEqual([]);
  });

  it("keeps the pi extension on its own files, core and pi's packages", () => {
    expect(importsUnder("extensions/pi").filter(breaksPiRule).map(describeImport)).toEqual([]);
  });

  it("keeps the bb plugin on its own files, reaching core only by relative path into src/", () => {
    expect(importsUnder("extensions/bb").filter(breaksBbRule).map(describeImport)).toEqual([]);
  });

  it("points the pi and bb manifests at files that exist in their extension", () => {
    const entries: [string, string][] = [
      ...manifest.pi.extensions.map((entry: string) => [entry, "extensions/pi"]),
      [manifest.bb.server, "extensions/bb"],
      [manifest.bb.app, "extensions/bb"],
    ];

    for (const [entry, dir] of entries) {
      const path = join(ROOT, entry);
      expect(existsSync(path) && statSync(path).isFile(), entry).toBe(true);
      expect(inside(relative(ROOT, path), dir), entry).toBe(true);
    }
  });

  // bb names a skill after its directory and reads only a regular SKILL.md inside the plugin.
  it("loads bb skills from real files inside the repository", () => {
    const repository = realpathSync(ROOT);
    const outside = (path: string) => relative(repository, realpathSync(path)).startsWith("..");

    expect(manifest.bb.skills.length).toBeGreaterThan(0);
    for (const root of manifest.bb.skills as string[]) {
      const dir = resolve(ROOT, root);
      expect(outside(dir), root).toBe(false);
      const skills = readdirSync(dir, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md")),
      );
      expect(skills, root).not.toEqual([]);
      for (const { name } of skills) {
        const skillFile = join(dir, name, "SKILL.md");
        expect(lstatSync(skillFile).isFile(), skillFile).toBe(true);
        expect(outside(skillFile), skillFile).toBe(false);
        expect(frontMatterName(skillFile), skillFile).toBe(name);
      }
    }
  });

  it("ships only core and the pi extension in the npm package", () => {
    const files = (manifest.files as string[]).map((entry) => entry.replace(/^\.\//, ""));

    expect(files).toEqual(expect.arrayContaining(["src/", "extensions/pi/"]));
    expect(
      files.filter((entry) => /^(extensions\/?$|extensions\/bb|test|tmp)/.test(entry)),
    ).toEqual([]);
  });

  // Without its `pi` manifest, pi loads TypeScript and JavaScript extensions from extensions/.
  it("never gives extensions/bb an index file that pi could load as an extension", () => {
    const entries = readdirSync(join(ROOT, "extensions/bb")).filter((name) =>
      /^index\.[cm]?[jt]sx?$/.test(name),
    );

    expect(entries).toEqual([]);
  });

  it("applies each import rule to the cases it exists for", () => {
    const from = (file: string, specifier: string): Import => ({
      file,
      specifier,
      target: specifier.startsWith(".")
        ? relative(ROOT, resolve(ROOT, dirname(file), specifier))
        : null,
    });
    const rejectedBy = (rule: (found: Import) => boolean, file: string, specifiers: string[]) =>
      specifiers.filter((specifier) => rule(from(file, specifier)));

    expect(
      rejectedBy(breaksCoreRule, "src/quest/x.ts", [
        "node:fs",
        "fs",
        "zod",
        "./types.js",
        "react",
        "@earendil-works/pi-tui",
        "../../extensions/pi/logger.js",
      ]),
    ).toEqual(["react", "@earendil-works/pi-tui", "../../extensions/pi/logger.js"]);
    expect(
      rejectedBy(breaksPiRule, "extensions/pi/x.ts", [
        "../../src/quest/types.js",
        "@earendil-works/pi-tui",
        "../bb/store.js",
        "pi-quests/src/quest/types.js",
        "@get-bb/plugin-sdk",
      ]),
    ).toEqual(["../bb/store.js", "pi-quests/src/quest/types.js", "@get-bb/plugin-sdk"]);
    expect(
      rejectedBy(breaksBbRule, "extensions/bb/x.ts", [
        "../../src/quest/dataplane.js",
        "./components/ui/button.js",
        "zod",
        "../pi/index.js",
        "typebox",
        "@earendil-works/pi-ai",
        "pi-quests",
      ]),
    ).toEqual(["../pi/index.js", "typebox", "@earendil-works/pi-ai", "pi-quests"]);
  });

  it("scans JavaScript as well as TypeScript sources", () => {
    const names = ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"];
    expect(names.filter((name) => !SOURCE_FILE.test(name))).toEqual([]);
    expect(["a.json", "a.md", "a.css"].filter((name) => SOURCE_FILE.test(name))).toEqual([]);
  });

  it("sees type-only imports", () => {
    expect(importsUnder("extensions/pi").map(describeImport)).toContain(
      "extensions/pi/session.ts imports @earendil-works/pi-coding-agent",
    );
  });
});
