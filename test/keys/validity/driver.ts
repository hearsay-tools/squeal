import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Case, CaseOutput } from "./case.js";
import { runCase } from "./harness.js";

/*
 * The bundle's entry (task 011-37 section 3): runs every case of a JSON file
 * at this tree and writes what each gave. It re-exports the validity path's
 * entries (section 2), so the bundle holds them whole and a line no case runs
 * shows in the coverage. Run as `node driver.mjs <cases.json> <out.json> <scratch>`.
 */

export * as keys from "../../../src/core/keys/index.js";
export { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
export * as records from "../../../src/core/scheduler/records.js";
export * as stability from "../../../src/core/scheduler/stability.js";
export * as storeResults from "../../../src/core/scheduler/store-results.js";
export { classify, stateFromResult } from "../../../src/core/state/derive.js";
export { describeFailure } from "../../../src/core/state/fingerprint.js";
export { heldFailure } from "../../../src/core/state/inherited.js";
export * as results from "../../../src/core/store/repos/results.js";
export * as schema from "../../../src/core/store/schema.js";

const [casesPath, outPath, scratch] = process.argv.slice(2);
if (casesPath !== undefined && outPath !== undefined && scratch !== undefined) {
  const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Case[];
  const out: Record<string, CaseOutput> = {};
  for (const [at, c] of cases.entries()) {
    const dir = join(scratch, String(at));
    mkdirSync(dir, { recursive: true });
    try {
      out[c.name] = await runCase(c, dir);
    } catch (error) {
      out[c.name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  writeFileSync(outPath, JSON.stringify(out));
}
