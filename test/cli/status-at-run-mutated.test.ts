import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove, resultRows } from "./proof-kit.js";
import { clean, run, runCommit } from "./status-at-kit.js";

/*
 * Review wave-11 B1 (row 023-18): a run file's outcome is read at the key the
 * gate kept it under, never at a key computed from the checkout after the
 * run. Here the test rewrites the tracked input it reads: at commit A it reads
 * `1`, writes `2` and fails. Keying the checkout after that run gives commit
 * B's key, which holds B's pass. The gate keeps nothing of A's run (its input
 * changed during it), so A's failure is shown as run, not stored.
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
const RUN = { allMissing: true, timeoutSeconds: 600 } as const;

/** Commit A holds `data/a.txt` as `1`, HEAD (B) as `2`; the test is the same at both. */
function mutating() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "data/a.txt": "1\n",
    [TEST.path]: MUTATES,
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "data/a.txt": "2\n" });
  const b = git(f.root, "rev-parse", "HEAD").trim();
  const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
  return { f, a, b, options };
}

interface Row {
  readonly at: {
    state: string;
    key?: string;
    origin?: { kind: string; commit?: string; stored?: boolean; notStored?: string };
  };
}
const rowOf = (out: string) => (JSON.parse(out).files as Row[])[0];

describe(
  "a run that changes its own input is not read as another commit's result (review wave-11 B1)",
  SLOW,
  () => {
    it("status --at --run shows A's failure, not B's stored pass", async () => {
      const { f, a, b, options } = mutating();
      // Row 023-29 (review wave-18 note 3): B is HEAD; the commit side's run at its boundary.
      const atB = await runCommit(f, { commit: b, run: RUN }, options);
      expect(JSON.parse(atB.out).run, atB.err).toMatchObject({ ran: 1, stored: 1 });
      expect(rowOf(atB.out)?.at.state).toBe("pass");
      const bKey = rowOf(atB.out)?.at.key;
      const rows = resultRows(f);
      clean(f);

      // Row 023-40: `status --at --run` queues in the commit daemon; the in-call run at its
      // boundary, until row 023-41 removes it.
      const atA = await runCommit(f, { commit: a, run: RUN }, options);
      const report = JSON.parse(atA.out);
      expect(report.run, atA.err).toMatchObject({ ran: 1, stored: 0 });
      const row = rowOf(atA.out);
      expect(row?.at.origin).toMatchObject({ kind: "run", commit: a, stored: false });
      // The run failed. `--run` keeps the gate's load retry (row 020-54): on a host whose load is
      // at or over its CPU count the gate runs a failed file once more, and this rerun reads the
      // `2` the first run wrote and passes. Either is the gate's own outcome of A's run, unstored;
      // never B's stored pass (the proof below runs with no retry and checks the failure itself).
      expect(["fail", "pass"]).toContain(row?.at.state);
      expect(row?.at.origin?.notStored).toMatch(/^the gate did not keep it/);
      expect(row?.at.key).not.toBe(bKey);
      expect(resultRows(f)).toBe(rows);
      clean(f);

      const later = await run(f, { commit: a, json: true }, options);
      expect(rowOf(later.out)?.at.state).toBe("no result");
      clean(f);
    });

    it("squeal proof: the red side's failure is not replaced by HEAD's stored pass", async () => {
      const { f, a, b, options } = mutating();
      // HEAD's pass is stored first, at the key the red checkout has after its run.
      // Row 023-29 (review wave-18 note 3): B is HEAD; the commit side's run at its boundary.
      const atB = await runCommit(f, { commit: b, run: RUN }, options);
      expect(JSON.parse(atB.out).run, atB.err).toMatchObject({ stored: 1 });
      clean(f);

      // Row 023-21 (D5.2, "A: every changed file"): the unchanged test names the changed data.
      const proof = await prove(
        f,
        { files: [TEST.path], base: a, case: "source", source: ["data/a.txt"] },
        options,
      );
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
