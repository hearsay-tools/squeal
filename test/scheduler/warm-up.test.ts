import { describe, expect, it } from "vitest";
import { readIgnoredReads } from "../../src/core/status/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { readRuns } from "../e2e/support.js";
import type { Harness } from "./helpers.js";
import { SLOW } from "./helpers.js";
import { BUILD, MANY, QUIET, READS, snapshot, VITEST, warmUpRepo } from "./warm-up-repo.js";

async function fullSuite(h: Harness, observeIgnored: boolean) {
  const record = await h.scheduler.requestFullSuite({ force: true, observeIgnored });
  await h.scheduler.idle();
  return record;
}

describe("a warm-up reports the ignored paths each file read (task 001-307)", SLOW, () => {
  it("stores them only for a flagged checkpoint, with keys, closures and results as without it", async () => {
    const { h } = await warmUpRepo();
    const baseline = snapshot(h);
    expect(baseline.files.map((f) => f.file)).toEqual(
      expect.arrayContaining([`forks:${VITEST}`, `threads:${VITEST}`, `nt:${READS}`]),
    );
    expect(baseline.checks.every((c) => c.endsWith(":current:pass"))).toBe(true);
    // The node:test closure holds what the file loads, never what it read.
    const reads = baseline.files.find((f) => f.file === `nt:${READS}`);
    expect(reads?.closure).toEqual(expect.arrayContaining(["nt/lib.mjs", READS]));
    expect(reads?.closure).not.toContain(BUILD);
    expect(reads?.closure).not.toContain("nt/preloaded.cjs");
    // 016 D4, the written-directory bound: Vitest's read of the ignored path is in its closure.
    for (const file of [`forks:${VITEST}`, `threads:${VITEST}`]) {
      expect(baseline.files.find((f) => f.file === file)?.closure, file).toContain(BUILD);
    }

    await fullSuite(h, false);
    expect(readIgnoredReads(h.store, h.worktreeId)).toBeNull();
    expect(snapshot(h)).toEqual(baseline);

    const record = await fullSuite(h, true);
    expect(snapshot(h)).toEqual(baseline);
    const stored = readIgnoredReads(h.store, h.worktreeId);
    expect(stored?.checkpoint).toBe(record.id);
    expect(stored?.revision).toBe(record.revision);
    expect(stored?.files[`nt\0${READS}`]).toEqual({ paths: [BUILD], more: 0 });
    // Capped at 50, sorted, with the count of the rest.
    const many = stored?.files[`nt\0${MANY}`];
    expect(many?.paths).toHaveLength(50);
    expect(many?.paths[0]).toBe("ignored/many/00.txt");
    expect(many?.paths[49]).toBe("ignored/many/49.txt");
    expect(many?.more).toBe(10);
    // An observed file that read nothing ignored beyond its closure has an empty entry; no test
    // file, none (with 005).
    const empty = [`forks\0${VITEST}`, `threads\0${VITEST}`, `nt\0${QUIET}`];
    for (const id of [...empty, "forks\0test/plain.test.ts", "threads\0test/plain.test.ts"]) {
      expect(stored?.files[id], id).toEqual({ paths: [], more: 0 });
    }
    expect(stored?.files["nt\0nt/lib.mjs"]).toBeUndefined();

    // A later checkpoint without the flag leaves the warm-up's record as it was.
    await fullSuite(h, false);
    expect(readIgnoredReads(h.store, h.worktreeId)).toEqual(stored);
  });

  it("names no file whose runner could not observe it (observe.runtimeInputs off)", async () => {
    const { h } = await warmUpRepo({ runtimeInputs: false });
    const record = await fullSuite(h, true);
    const stored = readIgnoredReads(h.store, h.worktreeId);
    expect(stored?.checkpoint).toBe(record.id);
    // Vitest records nothing with its observer off: no entry, never an empty one.
    expect(Object.keys(stored?.files ?? {}).sort()).toEqual([
      `nt\0${MANY}`,
      `nt\0${QUIET}`,
      `nt\0${READS}`,
    ]);
    expect(stored?.files[`nt\0${READS}`]).toEqual({ paths: [BUILD], more: 0 });
    expect(stored?.files[`nt\0${QUIET}`]).toEqual({ paths: [], more: 0 });
  });

  it("re-keys only the files whose closure holds an ignored path the warm-up reported for another", async () => {
    const { h, commonDir } = await warmUpRepo();
    await fullSuite(h, true);
    const before = snapshot(h);
    const runs = readRuns(storePaths(commonDir).database, h.worktreeId).length;
    h.write(BUILD, "built v2\n");
    await h.batch(BUILD);
    await h.scheduler.idle();
    // 016 D4: the Vitest file's closure holds it, so its key moves and the slow file waits for
    // the slow lane (004); the node:test file's reads are no closure path.
    expect(readRuns(storePaths(commonDir).database, h.worktreeId)).toHaveLength(runs);
    const after = snapshot(h);
    const keys = (s: typeof before, of: (file: string) => boolean) =>
      s.files.filter((f) => of(f.file)).map((f) => f.key);
    const vitest = (file: string) => file.endsWith(`:${VITEST}`);
    const old = keys(before, vitest);
    expect(old).toHaveLength(2);
    expect(keys(after, vitest).filter((key) => old.includes(key))).toEqual([]);
    const nt = (file: string) => file.startsWith("nt:");
    expect(keys(after, nt)).toEqual(keys(before, nt));
    expect(h.header().counts.pending).toBeGreaterThan(0);
  });
});
