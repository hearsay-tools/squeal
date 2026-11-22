import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Review wave-11 B1 (row 023-18): a run file's outcome is read at the key the
 * gate kept it under, never at a key computed from the checkout after the
 * run. Here the test rewrites the tracked input it reads: at commit A it reads
 * `1`, writes `2` and fails. Keying the checkout after that run gives commit
 * B's key, which holds B's pass. The gate keeps nothing of A's run (its input
 * changed during it), so A's failure is shown as run, not stored. Row
 * 023-41 removed the in-call `status --at --run` test; `squeal proof` keeps it.
 */

const TEST = ref("test/a.test.ts");
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

/** Commit A holds `data/a.txt` as `1`, HEAD (B) as `2`; the test is the same at both. */
function mutating() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "data/a.txt": "1\n",
    [TEST.path]: MUTATES,
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "data/a.txt": "2\n" });
  const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
  return { f, a, options };
}

describe(
  "a run that changes its own input is not read as another commit's result (review wave-11 B1)",
  SLOW,
  () => {
    it("squeal proof: the red side's failure is not replaced by HEAD's stored pass", async () => {
      const { f, a, options } = mutating();
      // Row 023-21 (D5.2, "A: every changed file"): the unchanged test names the changed data.
      const args = { files: [TEST.path], base: a, case: "source", source: ["data/a.txt"] } as const;
      // HEAD's pass is stored first, at the key the red checkout has after its run. Row 023-41:
      // a first proof stores it (its green side), where the removed in-call run did before.
      const first = await prove(f, args, options);
      expect(first.files[0]?.green, first.why).toMatchObject({ end: "pass", stored: true });
      clean(f);

      const proof = await prove(f, args, options);
      expect(proof.code, proof.why).toBe(0);
      expect(proof.files[0]).toMatchObject({
        verdict: "proven",
        red: { end: "fail", from: "run", stored: false },
        green: { end: "pass", from: "store" },
      });
      expect(proof.files[0]?.red.notStored).toMatch(/^the gate did not keep it/);
      clean(f);
    });
  },
);
