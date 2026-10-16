// Throwaway probe for issue 5 triage (spec 004). Reads no store, starts no
// daemon, queues no test: it calls the guidance generators directly on a
// policy loaded from a temp squeal.config.json, once per stop.requireSlowSuite.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy } from "../../../../../../src/core/daemon/policy.js";
import { stopSlowWaitMs } from "../../../../../../src/core/slow/stop-wait.js";
import { slowTierText } from "../../../../../../src/core/state/slow-text.js";
import { slowPolicyView } from "../../../../../../src/core/state/index.js";
import { codexCommand } from "../../../../../../src/harness/codex/command.js";
import { primer } from "../../../../../../src/harness/shared/primer.js";
import type { StatusHeader } from "../../../../../../src/core/types/index.js";

const codex = codexCommand({ PLUGIN_ROOT: "/plugins/squeal" }, "unused");

for (const requireSlowSuite of [false, true]) {
  const root = mkdtempSync(join(tmpdir(), "issue5-"));
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({ slow: { include: ["test/e2e/**"] }, stop: { requireSlowSuite } }),
  );
  const policy = readPolicy(root);
  rmSync(root, { recursive: true });
  // What coverageOf builds for this policy once the daemon listed 91 slow files.
  const coverage = {
    vitest: true,
    vitestConfig: "vitest.config.ts",
    nodeTest: [],
    slow: slowPolicyView(policy) === null ? null : { files: 91 },
  };
  const wait = stopSlowWaitMs(policy);
  // The issue's moment: 91 slow files, 89 pending, 2 not run (shape only).
  const header = {
    revision: 3,
    slowTier: {
      testFiles: 91, current: 0, pending: 89, notRun: 2, currentAt: null, artifact: [],
      sourcesChangedSince: false, activity: null,
      ...(wait === null ? {} : { stopWaitMs: wait }),
    },
  } as unknown as StatusHeader;
  console.log(`=== stop.requireSlowSuite: ${requireSlowSuite} (policy read: ${policy.stop.requireSlowSuite}, stopSlowWaitMs: ${wait})`);
  console.log("--- primer, Claude Code (squeal on PATH)");
  console.log(primer("squeal", coverage));
  console.log("--- primer, Codex (CLI by path)");
  console.log(primer(codex, coverage));
  console.log("--- header/status Slow tier: line");
  console.log(slowTierText(header, "squeal"));
  console.log();
}
