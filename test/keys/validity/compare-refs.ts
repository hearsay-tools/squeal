import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseKind } from "./case.js";
import { CASES } from "./cases/index.js";
import { compareTrees, failures, reportedChanges, wordingChanges } from "./compare.js";
import { execute, type Side } from "./sides.js";
import { extractTree } from "./trees.js";

/*
 * A one-off comparison of two refs, for a verdict on a past window (task
 * 011-37 section 4: the 12->13 cases at 2639208a and 87d7ced6) or on a
 * change before it is a release (013-02's barrier cases at 17 and 18):
 *
 *   npx tsx test/keys/validity/compare-refs.ts <baseline-ref> <candidate-ref> [kind...]
 *
 * Both trees are read with `git archive` into a temporary directory, removed
 * afterwards unless KEEP=1. Beside the comparison it prints the baseline's
 * own decision over the store it wrote, which D1 (a) leaves out of the verdict.
 */

const [baselineRef, candidateRef, ...kinds] = process.argv.slice(2);
if (baselineRef === undefined || candidateRef === undefined) {
  throw new Error("usage: compare-refs.ts <baseline-ref> <candidate-ref> [kind...]");
}
const work = mkdtempSync(join(tmpdir(), "squeal-validity-refs-"));
try {
  const baseline = join(work, "baseline-tree");
  const candidate = join(work, "candidate-tree");
  extractTree(baselineRef, baseline);
  extractTree(candidateRef, candidate);
  const cases =
    kinds.length === 0 ? CASES : CASES.filter((c) => kinds.includes(c.kind as CaseKind));
  const started = Date.now();
  const result = await compareTrees({ baseline, candidate, cases, work: join(work, "run") });
  console.log(
    `${baselineRef} (format ${result.versions.baseline}) -> ${candidateRef} (format ${result.versions.candidate}), ${Date.now() - started} ms, fired: ${result.fired}`,
  );
  for (const v of result.cases) {
    const keys = v.keysEqual ? "keys equal" : "keys differ";
    const outputs = v.outputsEqual ? "outputs equal" : "OUTPUTS DIFFER";
    const errors = [v.baseline.error, v.candidate.error].filter((e) => e !== undefined);
    console.log(
      `  ${v.kind}\t${v.name}: ${keys}, ${outputs}${v.wordingEqual ? "" : ", wording differs"}${errors.length > 0 ? `; thrown: ${errors.join(" | ")}` : ""}`,
    );
  }
  const own = cases.filter((c) => c.kind === "accept");
  if (own.length > 0 && result.fired) {
    const dir = join(work, "run", "baseline");
    const side = { name: "baseline", tree: baseline, dir, file: join(dir, "driver.mjs") } as Side;
    const decided = execute(join(work, "run"), side, "decide", cases, join(dir, "run"), "own");
    for (const c of own)
      console.log(
        `  own decision at ${baselineRef}: ${c.name}: ${JSON.stringify(decided[c.name])}`,
      );
  }
  console.log(`wording: ${JSON.stringify(wordingChanges(result))}`);
  for (const line of reportedChanges(result)) console.log(`  reported: ${line}`);
  console.log(`uncovered: ${result.uncovered.length}`);
  for (const line of failures(
    { ...result, versions: { baseline: 0, candidate: 0 } },
    baselineRef,
  )) {
    console.log(`  verdict under one format: ${line.slice(0, 400)}`);
  }
} finally {
  if (process.env.KEEP !== "1") rmSync(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
}
