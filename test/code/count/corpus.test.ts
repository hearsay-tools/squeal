import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import { keyed, languageOf, readReference, referenceKeyed } from "./reference.js";

/*
 * Spec 015 D3, goal 2: every JS and TS file of `src/` at a pinned commit
 * against ESLint's stored counts, and every `.py` file of the repository
 * against radon's. The sources are read from git at the commit, which CI's
 * full-history checkout holds (`fetch-depth: 0`).
 */

const ROOT = join(import.meta.dirname, "../../..");
const SLOW = { timeout: 120_000 } as const;

/** The text of each of `paths` at `commit`, from one `git cat-file --batch`. */
function readAt(commit: string, paths: readonly string[]): Map<string, string> {
  const out = execFileSync("git", ["-C", ROOT, "cat-file", "--batch"], {
    input: paths.map((path) => `${commit}:${path}\n`).join(""),
    maxBuffer: 1 << 28,
  });
  const texts = new Map<string, string>();
  let at = 0;
  for (const path of paths) {
    const header = out.subarray(at, out.indexOf(10, at)).toString();
    if (!header.includes(" blob ")) throw new Error(`git cat-file: ${header}`);
    const size = Number(header.split(" ")[2]);
    at += header.length + 1;
    texts.set(path, out.subarray(at, at + size).toString("utf8"));
    at += size + 1;
  }
  return texts;
}

function listAt(commit: string, pattern: RegExp, under: readonly string[] = []): string[] {
  return execFileSync("git", ["-C", ROOT, "ls-tree", "-r", "--name-only", commit, ...under], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => pattern.test(path))
    .sort();
}

describe("the counter on this repository at a pinned commit (spec 015 D3)", () => {
  it("equals ESLint's classic counts on every JS and TS file of src/", SLOW, async () => {
    const reference = readReference("src.eslint.json");
    const commit = reference.commit as string;
    const paths = listAt(commit, /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, ["src"]);
    expect(Object.keys(reference.files).sort()).toEqual(paths);
    const texts = readAt(commit, paths);
    const differ: string[] = [];
    let functions = 0;
    for (const path of paths) {
      const counted = await countFile(texts.get(path) ?? "", languageOf(path));
      functions += counted.functions.length;
      const mine = JSON.stringify([...keyed(counted.functions, "end")]);
      const theirs = JSON.stringify([...referenceKeyed(reference.files[path] ?? [])]);
      if (mine !== theirs) differ.push(path);
    }
    expect({ differ, functions }).toEqual({ differ: [], functions: 7042 });
  });

  it("equals radon's counts on every .py file of the repository", SLOW, async () => {
    const reference = readReference("py.radon.json");
    const commit = reference.commit as string;
    const paths = listAt(commit, /\.py$/);
    expect(Object.keys(reference.files).sort()).toEqual(paths);
    const texts = readAt(commit, paths);
    const differ: string[] = [];
    let functions = 0;
    for (const path of paths) {
      const counted = await countFile(texts.get(path) ?? "", "python");
      functions += counted.functions.length;
      const mine = JSON.stringify([...keyed(counted.functions, "start")]);
      const theirs = JSON.stringify([...referenceKeyed(reference.files[path] ?? [])]);
      if (mine !== theirs) differ.push(path);
    }
    expect({ differ, functions }).toEqual({ differ: [], functions: 488 });
  });
});
