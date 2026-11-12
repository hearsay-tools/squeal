import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { observedMetaKey, readSharedEntries } from "../../src/core/keys/observed.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { type FixtureRepo, withStore } from "../daemon/helpers.js";
import {
  featureRepo,
  gate,
  hasRecord,
  keepPolicy,
  keysNow,
  runIdsAt,
} from "./code-gate-keep-kit.js";

/*
 * Row 020-39 (spec 020 D17.3; `research/no-daemon-reuse.md`, option 1): in
 * a clone where no daemon ever ran, the gate keeps a file whose run read a
 * path beyond its imports at the key with that read, and merges the read
 * into the shared observed row, as the daemon does; the next run reads the
 * file from the stores. A git-ignored read is first seen during the run:
 * its file is kept one run later, once the merged read keys it.
 */

const SLOW = { timeout: 240_000 } as const;

const GROWN: TestFileRef = { project: "", path: "test/grown.test.ts" };
const IGNORED: TestFileRef = { project: "", path: "test/ignored.test.ts" };

/** A test of `src/grown.ts` that reads `path` at run time, which no import loads. */
const reads = (title: string, path: string) =>
  `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { grown } from "../src/grown.ts";\n\nit(${JSON.stringify(title)}, () => {\n  expect(grown(1)).toBe(1);\n  expect(readFileSync(new URL(${JSON.stringify(`../${path}`)}, import.meta.url), "utf8")).toMatch(/^\\w/);\n});\n`;

describe("squeal code --base where no daemon ever ran, a file that reads beyond its imports (row 020-39)", () => {
  let repo: FixtureRepo;

  beforeAll(() => {
    repo = featureRepo(keepPolicy("lookup-only"), {
      "src/grown.ts": "export const grown = (x: number) => (x > 0 ? 1 : 0);\n",
      "data/input.txt": "hello\n",
      // `src/gen/` is git-ignored in the fixture: on disk before the run, never committed.
      "src/gen/cache.txt": "cached\n",
      [GROWN.path]: reads("reads a tracked file", "data/input.txt"),
      [IGNORED.path]: reads("reads an ignored file", "src/gen/cache.txt"),
    });
  });

  afterAll(() => repo?.cleanup());

  it("is kept at the key with its read, which the observed row now holds", SLOW, async () => {
    const first = await gate(repo, ["src/grown.ts"]);

    expect([first.code, [...first.ran].sort()]).toEqual([0, [GROWN.path, IGNORED.path]]);
    expect(first.stderr).not.toMatch(/read paths (its key lacks|their keys lack)/);
    expect(first.stderr).toContain(
      "squeal code: 1 completed test file was not kept in the stores, because it read paths first seen during the run (src/gen/cache.txt): test/ignored.test.ts; the next run will run it again\n",
    );
    const rows = withStore(repo, (store) => readSharedEntries(store, observedMetaKey("")));
    expect(rows[GROWN.path]).toEqual(expect.arrayContaining(["data/input.txt"]));
    expect(rows[IGNORED.path]).toEqual(expect.arrayContaining(["src/gen/cache.txt"]));
    // The key a daemon, or the next gate run, gives it now: with the read the row holds.
    const [grown] = (await keysNow(repo, [GROWN])) as [CheckKey];
    expect(runIdsAt(repo, grown)[0]).toMatch(/^gate-/);
    expect(hasRecord(repo, grown)).toBe(true);
  });

  it(
    "is read from the stores on the next run, and the ignored read's file is kept then",
    SLOW,
    async () => {
      const second = await gate(repo, ["src/grown.ts"]);

      expect([second.code, second.ran]).toEqual([0, [IGNORED.path]]);
      expect(second.report.runs[0]?.from).toEqual({
        [GROWN.path]: "store",
        [IGNORED.path]: "run",
      });
      expect(second.stderr).not.toContain("was not kept in the stores");

      const third = await gate(repo, ["src/grown.ts"]);

      expect([third.code, third.ran]).toEqual([0, []]);
      expect(third.report.runs[0]?.from).toEqual({
        [GROWN.path]: "store",
        [IGNORED.path]: "store",
      });
    },
  );
});
