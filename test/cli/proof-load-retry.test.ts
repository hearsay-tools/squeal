import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGateFiles } from "../../src/cli/code-gate-files.js";
import { noLoadRetry } from "../../src/cli/status-at-run-child.js";
import type { HostLoad } from "../../src/core/retry/load.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture } from "../commit/at-keys-fixture.js";

/*
 * Row 023-11, candidate CI of 0.1.562 (run 44299153586): on a loaded host
 * the gate runs a failed file once more and keeps the rerun's result
 * (row 020-54). In a proof that turned a red failure on a later repeat,
 * and a green failure, into passes (`not red`, and `proven` where the test
 * wants `not green`). A proof's runs give the gate `noLoadRetry`. The load
 * is given through the gate's own `hostLoad` option, never made.
 */

/** A test that fails on its first run only, counting runs in `PROOF_COUNTER`. */
const FAILS_FIRST = [
  'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'it("value", () => {',
  '  const path = process.env.PROOF_COUNTER ?? "";',
  '  const n = (existsSync(path) ? Number(readFileSync(path, "utf8")) : 0) + 1;',
  "  writeFileSync(path, String(n));",
  "  expect(n).toBeGreaterThan(1);",
  "});",
  "",
].join("\n");

const OVERLOADED = (): HostLoad => ({ oneMinute: 1000, cpus: 1 });

async function runOnce(hostLoad: () => HostLoad) {
  const f = fixture({ "squeal.config.json": "{}\n", "test/a.test.ts": FAILS_FIRST });
  const result = await runGateFiles({
    root: f.root,
    files: ["test/a.test.ts"],
    budgetSeconds: 120,
    tempDir: mkdtempSync(join(f.dir, "tmp-")) as AbsolutePath,
    store: false,
    env: { ...process.env, PROOF_COUNTER: join(f.dir, "counter") },
    hostLoad,
  });
  return result.runs.map((r) => r.outcome);
}

describe("a proof's runs take no load retry (row 023-11)", { timeout: 120_000 }, () => {
  it("an overloaded host reruns a failed file and keeps the rerun's pass: what CI saw", async () => {
    expect(await runOnce(OVERLOADED)).toEqual(["passed"]);
  });

  it("with the proof's load reading the first failure stands", async () => {
    expect(await runOnce(noLoadRetry)).toEqual(["failed"]);
  });
});
