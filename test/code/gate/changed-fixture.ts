import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { ChangedFunction } from "../../../src/core/code/gate/types.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import { git as gitIn, initRepo, writeFile } from "../../hash/git-repo.js";

/*
 * Spec 020 D2: temporary git repositories under $TMPDIR for the tests of
 * the changed functions and the base's policy, removed after each test.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The default policy's count keys: include, exclude and the size limit. */
export const POLICY = {
  include: DEFAULT_POLICY.complexity.include,
  exclude: DEFAULT_POLICY.complexity.exclude,
  maxFileBytes: DEFAULT_POLICY.complexity.maxFileBytes,
};

export type Files = Readonly<Record<string, string>>;

/** `text`, each line ended by a newline. */
export const lines = (...text: string[]) => `${text.join("\n")}\n`;

export const ONE = "export function one(x: number) { if (x) return 1; return 2; }";
export const TWO = "export function two(x: number) { return x * 2; }";

/** Each function as `path name#occurrence change`. */
export function names(fns: readonly ChangedFunction[]): string[] {
  return fns.map((f) => `${f.path} ${f.count.qualifiedName}#${f.count.occurrence} ${f.change}`);
}

/**
 * A repository whose one commit holds `files` on branch `base`, checked out
 * on branch `work`, with `head` written over it.
 */
export function repo(files: Files, head: Files = {}) {
  const root = mkdtempSync(join(tmpdir(), "squeal-gate-changed-"));
  roots.push(root);
  const git = (...args: string[]) => gitIn(root, args).trim();
  const write = (more: Files) => {
    for (const [path, text] of Object.entries(more)) writeFile(root, path, text);
  };
  const commit = (more: Files, message = "c") => {
    write(more);
    git("add", "-A");
    git("commit", "-qm", message);
  };
  initRepo(root, files);
  git("branch", "-m", "base");
  git("checkout", "-q", "-b", "work");
  write(head);
  return { root, git, write, commit, remove: (path: string) => rmSync(join(root, path)) };
}
