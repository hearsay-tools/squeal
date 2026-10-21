import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFloor, REPO_ROOT } from "../src/harness/build.js";

/*
 * 011-86: `engines.node` in the root `package.json` is the one source of
 * Squeal's Node floor. The build reads it for the bundles' target and the
 * OpenCode plugin's check, so `src/` states no floor. A shipped file that
 * states one in words, in a shell variable or as CI's pinned Node states
 * that one, so a raise is one edit and this test names each place it missed.
 */

const read = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8");

/** Each way a file states a Node floor; the first group is the version. */
const STATEMENTS: readonly RegExp[] = [
  // "Node 22.19 or later", "Node 22.19+ or newer"
  /\bNode (\d+(?:\.\d+)*)\+? or (?:later|newer)\b/g,
  // "a Node of at least 22.19", "at least Node 22.19"
  /\bNode (?:of )?at least (\d+(?:\.\d+)*)/g,
  /\bat least Node (\d+(?:\.\d+)*)/g,
  // esbuild's target
  /\bnode(\d+\.\d+(?:\.\d+)?)\b/g,
  // install.sh and the launcher
  /^\s*NODE_FLOOR=["']?([^"'\s]+)/g,
];

/** A `node-version` of setup-node; a floor statement when its major is the floor's. */
const NODE_VERSION = /^\s*node-version:\s*["']?([^"'\s#]+)/;

interface Statement {
  readonly line: number;
  readonly version: string;
}

/** The floors `text` states, by 1-based line; a `node-version` counts in `floor`'s major. */
function statementsOf(text: string, floor: string): Statement[] {
  const major = floor.split(".")[0];
  return text.split("\n").flatMap((line, index) => {
    const versions = STATEMENTS.flatMap((pattern) =>
      [...line.matchAll(pattern)].map((m) => m[1] ?? ""),
    );
    const pinned = NODE_VERSION.exec(line)?.[1];
    if (pinned !== undefined && pinned.split(".")[0] === major) versions.push(pinned);
    return versions.map((version) => ({ line: index + 1, version }));
  });
}

/** Root-relative paths of the files that ship a floor: the READMEs, install.sh, launchers, src/, CI. */
function shipped(): string[] {
  const plugins = readdirSync(join(REPO_ROOT, "plugins"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => [`plugins/${d.name}/README.md`, `plugins/${d.name}/bin/squeal-launcher`]);
  const src = readdirSync(join(REPO_ROOT, "src"), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.endsWith(".wasm"))
    .map((d) => relative(REPO_ROOT, join(d.parentPath, d.name)));
  return ["README.md", "install.sh", ".github/workflows/ci.yml", ...plugins, ...src]
    .filter((path) => existsSync(join(REPO_ROOT, path)))
    .sort();
}

/** Each place among `files` that states a floor other than `floor`, or any floor in `src/`. */
function floorProblems(files: readonly string[], floor: string): string[] {
  return files.flatMap((file) =>
    statementsOf(read(file), floor).flatMap(({ line, version }) => {
      if (file.startsWith("src/")) {
        return [`${file}:${line} states Node ${version}; src/ reads the floor through nodeFloor`];
      }
      return version === floor
        ? []
        : [`${file}:${line} states Node ${version}; engines.node says ${floor}`];
    }),
  );
}

describe("Squeal's Node floor", () => {
  it("is engines.node in package.json, >=major.minor", () => {
    expect(nodeFloor()).toMatch(/^\d+\.\d+$/);
    expect(nodeFloor('{ "engines": { "node": ">=22.19" } }')).toBe("22.19");
    for (const range of [">=22", ">=22.19.0", "^22.19", "22.19"]) {
      expect(() => nodeFloor(JSON.stringify({ engines: { node: range } }))).toThrow(
        /engines\.node is .*, not >=<major>\.<minor>/,
      );
    }
    expect(() => nodeFloor("{}")).toThrow(/engines\.node is undefined/);
  });

  it("is stated nowhere else as another version, and nowhere in src/", () => {
    expect(floorProblems(shipped(), nodeFloor())).toEqual([]);
  });

  it("is stated by the README, install.sh, every launcher and CI's floor job", () => {
    const stating = shipped().filter(
      (file) => !file.startsWith("src/") && statementsOf(read(file), nodeFloor()).length > 0,
    );
    const launchers = shipped().filter((file) => file.endsWith("/bin/squeal-launcher"));
    expect(launchers).toHaveLength(4);
    expect(stating).toEqual(
      expect.arrayContaining(["README.md", "install.sh", ".github/workflows/ci.yml", ...launchers]),
    );
  });

  it("reads each phrasing a file states it in, and none of a fact about one version", () => {
    const text = [
      "Requires Node 22.13 or later on the PATH.",
      "it finds a Node of at least 22.13 on the `PATH`",
      'target: "node22.13",',
      "NODE_FLOOR=22.13",
      '          node-version: "22.13"',
      "          node-version: 22",
      "          node-version: 24",
      "Node 22.13 opens no SQLite URI, and `isTransaction` needs Node 22.16;",
      "Node 24.20 and later, on events forwarded from a test file's process.",
    ].join("\n");
    expect(statementsOf(text, "22.19")).toEqual([
      { line: 1, version: "22.13" },
      { line: 2, version: "22.13" },
      { line: 3, version: "22.13" },
      { line: 4, version: "22.13" },
      { line: 5, version: "22.13" },
      { line: 6, version: "22" },
    ]);
  });
});
