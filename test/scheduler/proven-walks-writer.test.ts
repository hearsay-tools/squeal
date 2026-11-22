import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { Policy } from "../../src/core/types/policy.js";
import type { FileImports } from "../../src/core/types/runner.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Review wave-23-third B2, option B (coordinator 2026-11-22; row 023-46,
 * `tasks/023-46-notes.md`, Round 4): a list with a path absent here is
 * still proven when the worktree that wrote it holds the key computed here
 * for the file, and no stored walk of the file read that path as a module.
 * Equal keys with the writer mean equal present paths and bytes, so the
 * paths absent here were absent where the list was walked.
 */

const F0 = fileName(0);
/** A manifest lookup absent in every worktree, as `src/package.json` is in this repository. */
const MANIFEST = "src/package.json";
const LOOKUP_ONLY: Pick<Policy, "baseline"> = { baseline: { onStart: "lookup-only" } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

const module = (path: string, statics: string[] = []): FileImports => ({
  path,
  sha1: "0".repeat(40),
  static: statics,
  dynamic: [],
});

/** A side whose runner walks `F0` to `paths` with `imports`, other files to themselves; and what it walked. */
function walking(
  root: string,
  of: (testFile: TestFileRef) => { paths: string[]; imports: FileImports[] },
): { s: Side; asked: string[] } {
  const s = side(root, { count: 2, policy: LOOKUP_ONLY, rerunCap: 0 });
  const asked: string[] = [];
  s.runner.closure = async (testFile) => {
    asked.push(testFile.path);
    return testFile.path === F0
      ? { testFile, ...of(testFile) }
      : { testFile, paths: [testFile.path], imports: [module(testFile.path)] };
  };
  return { s, asked };
}

async function started(w: { s: Side }): Promise<void> {
  await w.s.scheduler.start();
  await w.s.quiet();
}

/** F0 reads an absent manifest: the list's one unresolved path. */
const withManifest = () => ({ paths: [F0, MANIFEST], imports: [module(F0)] });

/** The writer's key row for F0 moved to `key`, as its next ledger commit would move it. */
function rowAt(s: Side, key: CheckKey): void {
  const testFile = { project: "", path: F0 };
  s.store.testFileKeys.upsertMany([
    { worktreeId: s.worktreeId, testFile, key, revision: 1, pending: null },
  ]);
}

describe("a list with an absent path is proven by its writer's key (B2, option B)", SLOW, () => {
  it("an absent manifest lookup is not walked when the list's writer holds the key", async () => {
    const { main, other } = claimRepo(2);
    const a = walking(main, withManifest);
    await started(a);
    expect(a.asked.sort()).toEqual([F0, fileName(1)]);

    const b = walking(other, withManifest);
    await started(b);
    expect(b.asked).toEqual([]);
    expect(b.s.keyOf(F0)).toBe(a.s.keyOf(F0));
  });

  it("a writer whose key for the file moved proves nothing: the file is walked", async () => {
    const { main, other } = claimRepo(2);
    const a = walking(main, withManifest);
    await started(a);
    rowAt(a.s, "f".repeat(64) as CheckKey);

    const b = walking(other, withManifest);
    await started(b);
    expect(b.asked).toEqual([F0]);
  });

  it("a writer still at the key in its commit window, whose walk read the absent file, proves nothing", async () => {
    const { main, others } = claimRepo(2, {}, 2);
    const [bRoot, cRoot] = others as [string, string];
    // A: `../src/foo` unresolved; its candidates are listed and absent. A keeps its row at K.
    const unresolved = () => ({ paths: [F0, "src/foo.js", "src/foo.ts"], imports: [module(F0)] });
    const a = walking(main, unresolved);
    await started(a);
    const k = a.s.keyOf(F0) as CheckKey;

    // B: `src/foo.js` exists there; its walk resolves the import, writes its list and walk row.
    const resolved = () => ({
      paths: [F0, "src/foo.js"],
      imports: [module(F0, ["src/foo.js"]), module("src/foo.js")],
    });
    mkdirSync(join(bRoot, "src"), { recursive: true });
    writeFileSync(join(bRoot, "src/foo.js"), "export const foo = 1;\n");
    const b = walking(bRoot, resolved);
    await started(b);
    expect(b.asked).toContain(F0);
    expect(b.s.keyOf(F0)).not.toBe(k);
    // The list is written; B's key row still holds K, as before its ledger commits.
    rowAt(b.s, k);

    // C, at A's files: B's list keys at K here (`src/foo.js` is absent), and B holds K.
    const c = walking(cRoot, unresolved);
    await started(c);
    expect(c.s.keyOf(F0)).toBe(k);
    expect(c.asked).toEqual([F0]);
  });
});
