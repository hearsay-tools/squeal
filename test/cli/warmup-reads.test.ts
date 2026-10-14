import { describe, expect, it } from "vitest";
import { ignoredReadNotes, ignoredReadText, slowFileReads } from "../../src/cli/warmup.js";
import type { IgnoredReads } from "../../src/core/status/index.js";
import type { ProjectName, RelativePath, TestFileRef } from "../../src/core/types/index.js";

/*
 * Row 005-29 (spec 005 D3, 001-307): what the warm-up says of each slow
 * file's ignored reads, from the record as stored. A slow file the record
 * does not hold is never said to have read none: from 001-312 every file a
 * warm-up observes has an entry, empty when it read none outside its
 * declared inputs, so a missing one was not observed (an older daemon).
 */

const ref = (project: string, path: string): TestFileRef => ({
  project: project as ProjectName,
  path: path as RelativePath,
});
const SLOW = "test/e2e/build.test.ts";
const FAST = "test/unit.test.ts";
const files = [ref("forks", SLOW), ref("threads", SLOW), ref("forks", FAST), ref("threads", FAST)];
const isSlow = (r: TestFileRef) => r.path === SLOW;
const record = (entries: IgnoredReads["files"]): IgnoredReads =>
  ({ checkpoint: "c1", revision: 3, files: entries }) as IgnoredReads;

describe("the warm-up's ignored reads of slow files", () => {
  it("says a slow file the warm-up did not observe was not observed, never that it read none", () => {
    const found = slowFileReads(record({}), files, isSlow);
    expect(found).toEqual({ reads: [], unobserved: [SLOW] });
    expect(ignoredReadNotes(found)).toEqual([
      `no ignored read recorded for ${SLOW}: not observed by this warm-up`,
    ]);
    // Without a record, as from a daemon that ignores observeIgnored, the same.
    expect(slowFileReads(null, files, isSlow)).toEqual(found);
  });

  it("names a slow file once across pools, its paths capped as stored, and no fast file", () => {
    const paths = Array.from({ length: 50 }, (_, i) => `dist/${String(i).padStart(2, "0")}.js`);
    const found = slowFileReads(
      record({
        [`threads\0${SLOW}`]: { paths: paths as RelativePath[], more: 10 },
        [`forks\0${FAST}`]: { paths: ["dist/fast.js" as RelativePath], more: 0 },
      }),
      files,
      isSlow,
    );
    expect(found.unobserved).toEqual([]);
    expect(found.reads).toEqual([{ path: SLOW, paths, more: 10 }]);
    const text = ignoredReadText(found.reads[0] as (typeof found.reads)[0]);
    expect(text.split("\n")[0]).toBe(
      `${SLOW} read 60 gitignored paths, unkeyed: a change to them re-runs nothing until declared; squeal setup --input ${SLOW}=<glob> declares one; declare build output, never a file the suite's own bootstrap rewrites (a descriptor, a log, a PID file), or every boot re-runs it`,
    );
    expect(text.split("\n").slice(1)).toEqual([...paths.map((p) => `    ${p}`), "    and 10 more"]);
    expect(ignoredReadNotes(found)).toEqual([]);
  });

  it("keeps every pool's reads of one slow file, and bounds their overflow (reviews/wave-2.5.md S2)", () => {
    const both = slowFileReads(
      record({
        [`forks\0${SLOW}`]: { paths: ["dist/a.js" as RelativePath], more: 0 },
        [`threads\0${SLOW}`]: { paths: ["dist/b.js" as RelativePath], more: 0 },
      }),
      files,
      isSlow,
    );
    expect(both.reads).toEqual([{ path: SLOW, paths: ["dist/a.js", "dist/b.js"], more: 0 }]);
    expect(ignoredReadText(both.reads[0] as (typeof both.reads)[0]).split("\n")[0]).toMatch(
      new RegExp(`^${SLOW} read 2 gitignored paths, unkeyed`),
    );
    const over = slowFileReads(
      record({
        [`forks\0${SLOW}`]: { paths: ["dist/a.js" as RelativePath], more: 3 },
        [`threads\0${SLOW}`]: { paths: ["dist/b.js" as RelativePath], more: 4 },
      }),
      files,
      isSlow,
    );
    const text = ignoredReadText(over.reads[0] as (typeof over.reads)[0]).split("\n");
    expect(text[0]).toMatch(new RegExp(`^${SLOW} read at least 2 gitignored paths, unkeyed`));
    expect(text.slice(1)).toEqual(["    dist/a.js", "    dist/b.js", "    and up to 7 more"]);
  });

  it("says a slow file observed with an empty entry read no ignored path", () => {
    const found = slowFileReads(
      record({ [`forks\0${SLOW}`]: { paths: [], more: 0 } }),
      files,
      isSlow,
    );
    expect(found).toEqual({ reads: [{ path: SLOW, paths: [], more: 0 }], unobserved: [] });
    expect(ignoredReadNotes(found)).toEqual([
      `${SLOW} read no ignored path outside its declared inputs`,
    ]);
  });
});
