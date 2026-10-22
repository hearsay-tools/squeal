import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseKind } from "./case.js";
import { CASES } from "./cases/index.js";
import { compareTrees, failures, reportedChanges, wordingChanges } from "./compare.js";
import { versionName } from "./components.js";
import { driverFile, execute, type Side } from "./sides.js";
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
  const versions = result.alarms
    .map(
      (a) =>
        `${a.component.name} ${a.versions.baseline}->${a.versions.candidate}${a.fired ? " fired" : ""}`,
    )
    .join(", ");
  console.log(
    `${baselineRef} -> ${candidateRef}, ${Date.now() - started} ms, fired: ${result.fired} (${versions})`,
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
    const side = { name: "baseline", tree: baseline, dir, file: driverFile(dir) } as Side;
    const decided = execute(join(work, "run"), side, "decide", cases, join(dir, "run"), "own");
    for (const c of own)
      console.log(
        `  own decision at ${baselineRef}: ${c.name}: ${JSON.stringify(decided[c.name])}`,
      );
  }
  console.log(`wording: ${JSON.stringify(wordingChanges(result))}`);
  for (const line of reportedChanges(result)) console.log(`  reported: ${line}`);
  console.log(`uncovered: ${result.uncovered.length}`);
  for (const alarm of result.alarms.filter((a) => a.uncovered.length > 0)) {
    const by = new Map<string, number>();
    for (const line of alarm.uncovered) {
      const [, file, side] = /^([^:\s]+):\d+.*\((\w+) bundle line/.exec(line) ?? [];
      const at = `${file ?? line} at the ${side ?? "?"}`;
      by.set(at, (by.get(at) ?? 0) + 1);
    }
    const files = [...by].map(([at, n]) => `${at}: ${n}`).join(", ");
    console.log(`  uncovered under ${versionName(alarm.component)}: ${files}`);
  }
  // Each version held at the baseline's, so a raise between two past releases still shows every check.
  const held = result.alarms.map((a) => ({
    ...a,
    versions: { baseline: a.versions.baseline, candidate: a.versions.baseline },
  }));
  for (const line of failures({ ...result, alarms: held }, baselineRef)) {
    console.log(`  verdict under one format: ${line.slice(0, 400)}`);
  }
} finally {
  if (process.env.KEEP !== "1") rmSync(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
}
