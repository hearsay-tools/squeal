import { describe, expect, it } from "vitest";
import { sideKeys } from "../../src/core/commit/at-keys-side.js";
import { fixture, git, keying, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-42, the coordinator's questions and issue #264: can a proof's
 * side read a result stored from the other side's code version?
 *
 * 1. `--source` with the product file read at run time, or imported: no.
 *    Before any run both commits key the runtime read's test alike, but a
 *    run is kept at the key taken after it, which covers the file it read;
 *    the sides' results land at different keys, and over two calls and
 *    `--env` the red side always fails from A's code.
 * 2. A test that rewrites the input it reads for the first time: yes, a
 *    wrong result. Under a condition, the red side's control run (P9, no
 *    condition, stored) is kept at the key the file has at both commits
 *    before any run, and the input it read is not recorded, so HEAD's key
 *    holds A's failure for every later reader (a temporary checkout at
 *    HEAD here; `status --at`, `proof` and a worktree daemon at HEAD key
 *    it alike, D2). The `it.fails` case states the right result and fails
 *    while the defect stands: the known defect "rewritten first-seen input
 *    kept at the pre-run key", the board row beside issue #264 that the
 *    coordinator adds; drop `.fails` with its fix.
 */

const TEST = ref("test/a.test.ts");

const READS = [
  'import { readFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'it("value", () => expect(readFileSync(new URL("../src/value.txt", import.meta.url), "utf8").trim()).toBe("2"));',
  "",
].join("\n");
const IMPORTS = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/value";',
  'it("value", () => expect(value).toBe(2));',
  "",
].join("\n");
const MUTATES = [
  'import { readFileSync, writeFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'it("value", () => {',
  '  const path = new URL("../data/a.txt", import.meta.url);',
  '  const got = readFileSync(path, "utf8").trim();',
  '  if (got === "1") writeFileSync(path, "2\\n");',
  '  expect(got).toBe("2");',
  "});",
  "",
].join("\n");

/** The outcomes stored at the key a temporary checkout at `commit` gives the test. */
async function storedAt(f: ReturnType<typeof fixture>, commit: string): Promise<string[]> {
  const keys = await sideKeys({
    ...keying(f),
    root: f.root,
    code: commit,
    tests: commit,
    files: [TEST],
  });
  const at = [...keys.values()][0];
  return at !== undefined && "key" in at ? at.stored.map((r) => r.outcome).sort() : [];
}

describe(
  "a proof's sides and results of the other code version (row 023-42, issue #264)",
  SLOW,
  () => {
    it.each([
      ["read at run time", READS, "src/value.txt", "1\n", "2\n"],
      [
        "imported",
        IMPORTS,
        "src/value.ts",
        "export const value = 1;\n",
        "export const value = 2;\n",
      ],
    ])(
      "--source, the product file %s: the red side never reads the green side's pass",
      async (_, test, path, at, now) => {
        const f = fixture({ "squeal.config.json": "{}\n", [path]: at, [TEST.path]: test });
        const base = git(f.root, "rev-parse", "HEAD").trim();
        f.commit({ [path]: now });
        const args = { files: [TEST.path], base, source: [path] };
        for (const more of [{}, {}, { env: [{ name: "PROOF_UNUSED", value: null }] }, {}]) {
          const result = await prove(f, { ...args, ...more });
          expect(result.code, result.why).toBe(0);
          expect(result.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail" } });
        }
        clean(f);
      },
    );

    it.fails("a control run of a test that rewrites its first-seen input leaves no failure at HEAD's key", async () => {
      const f = fixture({
        "squeal.config.json": "{}\n",
        "data/a.txt": "1\n",
        [TEST.path]: MUTATES,
      });
      const base = git(f.root, "rev-parse", "HEAD").trim();
      const head = f.commit({ "data/a.txt": "2\n" });
      const env = [{ name: "PROOF_UNUSED", value: null }];
      const args = {
        files: [TEST.path],
        base,
        case: "source",
        source: ["data/a.txt"],
        env,
      } as const;
      const result = await prove(f, args);
      expect(result.files[0], result.why).toMatchObject({ verdict: "proven" });
      // HEAD passes; a result at HEAD's key from A's control run is A's, not HEAD's.
      expect(await storedAt(f, head)).not.toContain("fail");
    });
  },
);
