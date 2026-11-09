import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import type { ChangedSet, CountedPath } from "../../../src/core/code/gate/types.js";
import { blobHash } from "../../../src/core/hash/blob.js";
import { git, initRepo } from "../../hash/git-repo.js";

/*
 * Spec 020 D3 (row 020-03): fixture projects for the one-shot collector,
 * copied under the fixtures' git-ignored `.tmp/`, so `vitest` resolves from
 * the repository's `node_modules`, each a git repository of its own.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/code/gate");
const SCRATCH = join(FIXTURES, ".tmp");

/** Each case starts real Vitest instances and node:test processes; a loaded host needs headroom. */
export const SLOW = { timeout: 120_000 } as const;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A committed copy of `test/fixtures/code/gate/<name>`, removed after the test. */
export function project(name: string): string {
  mkdirSync(SCRATCH, { recursive: true });
  const root = join(SCRATCH, `${name}-${randomUUID()}`);
  cpSync(join(FIXTURES, name), root, { recursive: true });
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  initRepo(root, {});
  return root;
}

/**
 * A `TMPDIR` of the test's own while it runs, so a test can see that the
 * collector leaves nothing there. Restored, and removed, after the test.
 */
export function ownTmpdir(): () => readonly string[] {
  const before = process.env.TMPDIR;
  const dir = mkdtempSync(join(tmpdir(), "squeal-gate-test-"));
  process.env.TMPDIR = dir;
  cleanups.push(() => {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(dir, { recursive: true, force: true });
  });
  return () => readdirSync(dir);
}

/** What `git status` lists, ignored paths included. */
export function status(root: string): string {
  return git(root, ["status", "--porcelain", "--ignored", "--untracked-files=all"]);
}

/** The `ChangedSet` of `paths` at their bytes now, every function edited. */
export async function changedSet(root: string, paths: readonly string[]): Promise<ChangedSet> {
  const counted: CountedPath[] = await Promise.all(
    [...paths].sort().map(async (path) => {
      const bytes = readFileSync(join(root, path));
      const blob = blobHash(bytes, "sha1");
      const count = await countFile(bytes.toString("utf8"), "typescript", blob);
      return { path, blob, functions: count.functions };
    }),
  );
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  return {
    ref: "HEAD",
    baseCommit: head,
    headCommit: head,
    dirty: false,
    functions: counted.flatMap(({ path, blob, functions }) =>
      functions.map((count) => ({ path, blob, change: "edited" as const, count })),
    ),
    counted,
    inErrors: [],
    uncounted: [],
  };
}
