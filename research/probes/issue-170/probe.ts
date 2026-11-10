// Throwaway research probe: synthetic store, real readers and formatters.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { readLintCounts } from "../../../src/core/commit/lint.js";
import { commitReportText } from "../../../src/core/commit/text.js";
import {
  lintScope,
  writeCursor,
  writeInputs,
  writeOff,
} from "../../../src/core/lint/pass/records.js";
import { isLintStoreOpenFailure, openLintStore } from "../../../src/core/lint/store/open.js";
import { lintStatusLines } from "../../../src/core/lint/surface/format.js";
import { countsOf, reasonsOf } from "../../../src/core/lint/surface/snapshot.js";
import type { LintKnownState } from "../../../src/core/types/lint.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

const load = loadavg()[0];
const cpuCount = cpus().length;
console.log(
  JSON.stringify({
    time: new Date().toISOString(),
    version: JSON.parse(readFileSync("package.json", "utf8")).version,
    node: process.version,
    oneMinuteLoad: load,
    cpuCount,
  }),
);
if (load > cpuCount) {
  console.log("SKIP: one-minute load exceeds CPU count");
  process.exit(77);
}
const policy = {
  ...DEFAULT_POLICY,
  lint: { ...DEFAULT_POLICY.lint, enabled: true, tools: ["oxlint"] as const },
};
const worktree = "issue-170";
const scope = lintScope(worktree, "oxlint");
const reason = "the oxlint run failed 3 times; timed out after 5 s.";
const paths = Array.from({ length: 25 }, (_, n) => `src/file-${n}.ts`);
const side = {
  committed: new Map(paths.map((path) => [path, `blob-${path}`])),
  changed: new Set(paths),
  differing: new Set<string>(),
  environment: false,
};
const cases = [
  { name: "policy-disabled", enabled: false, off: false, outcome: null },
  { name: "provider-off-empty", enabled: true, off: true, outcome: null },
  { name: "provider-off-unknown", enabled: true, off: true, outcome: "unknown" },
  { name: "unknown", enabled: true, off: false, outcome: "unknown" },
  { name: "complete-pass", enabled: true, off: false, outcome: "pass" },
] as const;
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-issue-170-"));
  const store = openLintStore(dir, policy);
  if (isLintStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  try {
    if (c.off) writeOff(store.meta, scope, reason, "oxlint");
    const states: LintKnownState[] =
      c.outcome === null
        ? []
        : paths.map((path) => ({
            worktreeId: worktree,
            check: { kind: "lint", tool: "oxlint", path },
            outcome: c.outcome,
            stale: false,
            changedAt: 1,
            reason: c.outcome === "unknown" ? "timed out after 5 s." : null,
            judged:
              c.outcome === "pass"
                ? {
                    key: `key-${path}`,
                    outcome: "pass",
                    fingerprint: null,
                    blob: `blob-${path}`,
                    revision: 1,
                  }
                : null,
          }));
    store.states.upsertMany(states);
    if (c.outcome === "pass") {
      writeCursor(store.meta, scope, { revision: 1, environment: "fixture-env" });
      writeInputs(store.meta, scope, { environment: "fixture-env", installed: false, files: [] });
      for (const state of states) {
        assert.ok(state.judged);
        store.results.put(
          {
            check: state.check,
            key: state.judged.key,
            outcome: "pass",
            findings: [],
            fingerprint: null,
            toolVersion: "synthetic",
            lintedAt: 1,
          },
          1,
        );
      }
    }
    const lint = readLintCounts(dir, { ...policy.lint, enabled: c.enabled }, worktree, side);
    const text = commitReportText({
      commit: "c9d85ae0000000000000000000000000000000000",
      revision: 20,
      at: 1,
      tests: { files: 0, failures: 0, notDetermined: 0, running: 0, unknown: 0 },
      ...(lint === undefined ? {} : { lint }),
    });
    const status = c.enabled
      ? lintStatusLines(
          {
            v: 1,
            ...countsOf(states),
            ...reasonsOf(store, worktree),
            since: null,
            sinceRegistration: 0,
          },
          "squeal",
        )
      : [];
    if (!c.enabled) assert.equal(lint, undefined);
    else
      assert.deepEqual(lint, {
        findings: 0,
        notDetermined: c.outcome === "unknown" ? 25 : 0,
        running: 0,
      });
    assert.equal(text.includes("lint 0 findings"), c.enabled);
    if (c.off) assert.ok(status[0].startsWith("Lint: off:"));
    console.log(
      JSON.stringify({
        case: c.name,
        storedStates: states.length,
        lint: lint ?? null,
        commitText: text,
        status,
      }),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("PASS: all five observed-behaviour controls matched");
