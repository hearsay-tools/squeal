import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ObservedSets } from "../../src/core/keys/index.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Row 011-158 (011 C3; `research/missed-sharing.md` cause D): closure lists
 * and observed sets are shared per project, and the last worktree that
 * resolves a list writes it. So a branch that adds a module and runs a test
 * file that reads it names that module in every worktree's closure of the
 * file. A path with no file enters no key, so a worktree at equal content
 * keys the file as the worktree that ran it did, and its start finds that
 * worktree's pass. Adding the module still re-keys the file: through the
 * reverse index where the closure names it, and through C3's add rule, which
 * re-resolves the closures of a directory's importers, where it does not.
 */

const F0 = fileName(0);
const REF: TestFileRef = { project: "", path: F0 };
const MODULE = "src/m.ts";
/** The module another branch adds, which its run of F0 resolves and reads. */
const FOCUS = "src/focus.ts";
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/**
 * `s`'s runner resolves F0 to itself and `src/m.ts`, and to `src/focus.ts`
 * too once that file exists, as an import that resolves there. Returns how
 * often the runner was asked.
 */
function resolving(s: Side): () => number {
  let calls = 0;
  s.runner.closure = async (testFile: TestFileRef) => {
    calls += 1;
    const focus = existsSync(join(s.root, FOCUS)) ? [FOCUS] : [];
    return { testFile, paths: [testFile.path, MODULE, ...focus] };
  };
  return () => calls;
}

const add = (root: string) => writeFileSync(join(root, FOCUS), "export const focus = 1;\n");

describe("a path only another branch has (011-158)", SLOW, () => {
  it("keys a file at equal content alike, so the start finds the other worktree's pass, and re-keys it when the path is added in either", async () => {
    const { others } = claimRepo(1, { [MODULE]: "export const m = 1;\n" }, 3);
    const [first, second, third] = others as [string, string, string];
    const a = side(first, { count: 1, policy: RUN_MISSING });
    const aResolved = resolving(a);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runner.ran(F0)).toBe(1);
    const key = a.keyOf(F0);
    expect(key).toEqual(expect.any(String));

    // Another branch adds the module and imports it; its run resolves and reads it, and writes the
    // shared list last.
    add(third);
    writeFileSync(join(third, MODULE), 'import "./focus";\nexport const m = 1;\n');
    const c = side(third, { count: 1, policy: RUN_MISSING });
    resolving(c);
    await c.scheduler.start();
    await c.scheduler.idle();
    expect(c.runner.ran(F0)).toBe(1);
    expect(c.keyOf(F0)).not.toBe(key);
    new ObservedSets(c.store).add(REF, [FOCUS]);
    expect(c.store.testFiles.get(REF)?.closure.paths).toContain(FOCUS);

    // At a's content, under lookup-only: the first lookup keys F0 from the shared list.
    const b = side(second, { count: 1 });
    const bResolved = resolving(b);
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    expect(b.keyOf(F0)).toBe(key);
    expect(b.passing()).toBe(1);
    expect(bResolved()).toBe(0);

    // Added where the closure names it: the reverse index re-keys F0, and it runs.
    add(second);
    await b.batch(FOCUS);
    await b.scheduler.idle();
    expect(b.keyOf(F0)).not.toBe(key);
    expect(b.runner.ran(F0)).toBe(1);

    // Added where the closure does not name it: the add rule re-resolves F0, an importer of `src/`.
    const asked = aResolved();
    add(first);
    await a.batch(FOCUS);
    await a.scheduler.idle();
    expect(aResolved()).toBeGreaterThan(asked);
    expect(a.keyOf(F0)).not.toBe(key);
    // At b's content again: the pass b's run stored stands here.
    expect(a.keyOf(F0)).toBe(b.keyOf(F0));
    expect(a.runner.ran(F0)).toBe(1);
    expect(a.passing()).toBe(1);
  });
});
