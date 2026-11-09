import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFunctions } from "../../../src/core/code/gate/changed.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

/*
 * Spec 020 D2: the changed functions of the working tree against the merge
 * base of a ref, in temporary git repositories.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const POLICY = {
  include: DEFAULT_POLICY.complexity.include,
  exclude: DEFAULT_POLICY.complexity.exclude,
  maxFileBytes: DEFAULT_POLICY.complexity.maxFileBytes,
};

/** A repository whose first commit holds `files`, on branch `base`, then checked out on `work`. */
function repo(files: Readonly<Record<string, string>>): {
  root: string;
  write: (files: Readonly<Record<string, string>>) => void;
  git: (...args: string[]) => string;
} {
  const root = mkdtempSync(join(tmpdir(), "squeal-gate-changed-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: root,
      encoding: "utf8",
    });
  const write = (more: Readonly<Record<string, string>>) => {
    for (const [path, text] of Object.entries(more)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  };
  git("init", "-q", "-b", "base");
  write(files);
  git("add", ".");
  git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "work");
  return { root, write, git };
}

function names(fns: readonly { path: string; change: string; count: { qualifiedName: string } }[]) {
  return fns.map((f) => `${f.path} ${f.count.qualifiedName} ${f.change}`);
}

describe("changedFunctions", () => {
  it("returns an edited function, not a moved one or a test callback that only shifted", async () => {
    const { root, write } = repo({
      "src/a.ts": [
        "export function edited(x: number) { return x + 1; }",
        "export function moved(x: number) { if (x) return 1; return 2; }",
        "",
      ].join("\n"),
      "src/b.ts": "export function other() { return 0; }\n",
      "test/a.test.ts": [
        'import { it } from "vitest";',
        'it("one", () => { expect(1).toBe(1); });',
        'it("two", () => { expect(2).toBe(2); });',
        "",
      ].join("\n"),
    });
    write({
      "src/a.ts": "export function edited(x: number) { return x + 2; }\n",
      "src/b.ts": [
        "export function other() { return 0; }",
        "export function moved(x: number) { if (x) return 1; return 2; }",
        "",
      ].join("\n"),
      // "one" removed: "two" is now occurrence 0 of `<it>`, with its own body.
      "test/a.test.ts": [
        'import { it } from "vitest";',
        'it("two", () => { expect(2).toBe(2); });',
        "",
      ].join("\n"),
    });

    const changed = await changedFunctions(root, "base", POLICY);

    expect(names(changed.functions)).toEqual(["src/a.ts edited edited"]);
  });
});
