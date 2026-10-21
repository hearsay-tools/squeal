import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Case, CaseOutput } from "./case.js";
import { decideCase, runCase } from "./harness.js";

/*
 * The bundle's entry (task 011-37 section 3). It re-exports every
 * component's entries (`components.ts`, section 2), so the bundle holds them
 * whole and a line no case runs shows in the coverage. Imported, it runs
 * nothing: the comparison tests import it so their closure holds the
 * entries and the harness.
 *
 *   node driver.mjs run <cases.json> <out.json> <scratch> <runtime>
 *     runs every case at this tree; case i writes under <scratch>/<i>.
 *   node driver.mjs decide <cases.json> <out.json> <scratch> <stored>
 *     decides, at this tree, over what a run at either tree stored under <stored>/<i>.
 */

export * as global from "./entries/global.js";
export * as nodeTest from "./entries/node-test.js";
export * as pytest from "./entries/pytest.js";
export * as recorder from "./entries/recorder.js";
export * as vitest from "./entries/vitest.js";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const [script, mode, casesPath, outPath, scratch, other] = process.argv.slice(1);
// Node runs its entry at the real path, which a temporary directory may not be (macOS).
const main = script !== undefined && realpathSync(script) === fileURLToPath(import.meta.url);
if (main && casesPath !== undefined && outPath !== undefined && scratch !== undefined && other) {
  const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Case[];
  const out: Record<string, CaseOutput> = {};
  for (const [at, c] of cases.entries()) {
    const dir = join(scratch, String(at));
    mkdirSync(dir, { recursive: true });
    try {
      const output =
        mode === "decide"
          ? await decideCase(c, join(other, String(at)), dir)
          : await runCase(c, dir, other);
      if (output !== undefined) out[c.name] = output;
    } catch (error) {
      out[c.name] = { error: message(error) };
    }
  }
  writeFileSync(outPath, JSON.stringify(out));
}
