// Throwaway probe for row 005-94: the "before" texts, from the real formatters. See README.md.
process.env.TZ = "UTC";
import { formatDelta, formatRegistration, sawEditLine, settledLine, sawSettledLine, quietEditsText } from "../../../../../../src/core/delivery/format.js";
import { headerLines } from "../../../../../../src/core/delivery/header.js";
import { readPolicy } from "../../../../../../src/core/daemon/policy.js";
import { runnerCoverage } from "../../../../../../src/runners/descriptions.js";
import { DEFAULT_COVERAGE, type Coverage } from "../../../../../../src/harness/shared/coverage.js";
import { primer, PRIMER_CAP_CHARS, withPrimer } from "../../../../../../src/harness/shared/primer.js";
import { statusText } from "../../../../../../src/harness/shared/text.js";
import { codexCommand } from "../../../../../../src/harness/codex/command.js";
import type { StatusHeader } from "../../../../../../src/core/types/status.js";
import type { Registration, Delta } from "../../../../../../src/core/types/delivery.js";

const root = process.cwd();
const own = runnerCoverage(readPolicy(root as never), root as never);
const cezarRoot = process.env.CEZAR_ROOT;

/** This repository's coverage: Vitest with its config, test/e2e excluded, no slow files, no groups. */
const DEFAULT: Coverage = { ...own, slow: null };
/** Cezar's, as test/harness/primer-over-cap.test.ts pins it (row 005-89). */
const CEZAR: Coverage = {
  ...DEFAULT_COVERAGE,
  vitest: true,
  nodeTest: [
    { name: "test:unit", include: ["packages/cezar/test/unit/*.test.ts"] },
    { name: "root:test:unit", include: [".github/scripts/*.test.cjs", "scripts/*.test.mjs", ".ai/skills/*/scripts/*.test.mjs"] },
  ],
  slow: { files: 0, requireSlowSuite: false },
  groups: { moments: [ { at: "edit", names: ["lint", "tests"] }, { at: "pause", names: ["run-loop"] }, { at: "manual", names: ["browser"] } ] },
};
/** This repository's coverage with 3 slow files and stop.requireSlowSuite on. */
const SLOW: Coverage = { ...own, slow: { files: 3, requireSlowSuite: true } };

const CODEX = codexCommand({ PLUGIN_ROOT: "~/.codex/plugins/cache/squeal/squeal/0.1.531" }, "/unused.mjs");

const out = (title: string, text: string) => console.log(`\n===== ${title} (${text.length} chars)\n${text}`);

// ---- 1. primers
for (const [name, cov] of [["default", DEFAULT], ["cezar", CEZAR], ["slow-on", SLOW], ["DEFAULT_COVERAGE", DEFAULT_COVERAGE]] as const) {
  out(`primer ${name} squeal`, primer("squeal", cov));
  const c = primer(CODEX, cov);
  console.log(`\n----- primer ${name} codex: ${c.length} chars; path wait: ${c.includes("status --wait 60000 <path>...")}; CLI length ${CODEX.length}`);
}
console.log(`\nPRIMER_CAP_CHARS=${PRIMER_CAP_CHARS}`);
if (cezarRoot !== undefined) {
  const real = runnerCoverage(readPolicy(cezarRoot as never), cezarRoot as never);
  console.log(`\n----- cezar runnerCoverage read from its config: ${JSON.stringify(real)}`);
}

// ---- 2. registration headers
const NOW = Date.UTC(2026, 10, 16, 1, 16, 30);
const base: StatusHeader = {
  revision: 79,
  commit: { head: "a8f6984d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a69" as never, sinceHead: 3, dirty: true },
  counts: { current: 4400, pending: 120, stale: 0, unknown: 36 },
  fileLevelCounts: { current: 468, pending: 12, stale: 0, unknown: 4 },
  testFilesWithoutChecks: { pending: 0, unknown: 100 },
  testFileCounts: { current: 468, pending: 12, stale: 0, unknown: 104 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
  daemon: { state: "alive", lastHeartbeatAt: NOW as never },
  testFilesListed: true,
  inheritedCount: 4100,
  inheritedFileLevelCount: 440,
  importedCount: 0,
};
const reg = (header: StatusHeader, extra: Partial<Registration> = {}): Registration => ({
  schemaVersion: 1 as never,
  consumer: { worktreeId: "wt" as never, sessionId: "s1", agentId: "main" },
  header,
  knownFailures: [],
  ...extra,
});
const code = { code: { v: 1 as const, threshold: 20, over: 74 } };
const lint = { lint: { v: 1 as const, failing: 2, stale: 0 } };
const browser = { name: "browser", at: "manual" as const, after: [], quietMs: 0, testFiles: 9, current: 0, pending: 0, notRun: 9, currentAt: null, activity: null };

out("registration default, listed", formatRegistration(reg({ ...base, importedCount: 12 }, code)));
out("registration cezar, listed", formatRegistration(reg({ ...base, slowTier: { testFiles: 0, current: 0, pending: 0, notRun: 0, currentAt: null, activity: null }, groupTiers: [browser] }, { ...code, ...lint })));
out("registration slow-on, listed", formatRegistration(reg({ ...base, slowTier: { testFiles: 3, current: 1, pending: 0, notRun: 2, currentAt: 75, activity: null, stopWaitMs: 120_000 } }, code)));
out("registration all current, full suite at revision", formatRegistration(reg({ ...base, counts: { current: 4556, pending: 0, stale: 0, unknown: 0 }, fileLevelCounts: { current: 484, pending: 0, stale: 0, unknown: 0 }, testFilesWithoutChecks: { pending: 0, unknown: 0 }, testFileCounts: { current: 484, pending: 0, stale: 0, unknown: 0 }, fullSuite: { atCurrentRevision: true, lastCompletedRevision: 79 }, inheritedCount: 0 }, code)));
const unlisted: StatusHeader = { ...base, revision: 0, commit: undefined, counts: { current: 0, pending: 0, stale: 0, unknown: 0 }, fileLevelCounts: { current: 0, pending: 0, stale: 0, unknown: 0 }, testFilesWithoutChecks: { pending: 0, unknown: 0 }, testFileCounts: { current: 0, pending: 0, stale: 0, unknown: 0 }, testFilesListed: false, inheritedCount: 0, daemon: { state: "down", since: null, startingSince: NOW } as never };
out("registration unlisted", formatRegistration(reg(unlisted, { code: { v: 1, threshold: 20, over: 0, counting: { done: 0, total: 0 } } })));
out("registration unlisted + primer default (whole hook text)", withPrimer(reg(unlisted), "squeal", DEFAULT));

// ---- 3. Stop with no delta
out("stop unlisted", statusText(unlisted, [], "squeal"));
out("stop listed default", statusText({ ...base }, [], "squeal"));

// ---- 4. late feed, news form and full form
const late: StatusHeader = { ...base, daemon: { state: "alive", lastHeartbeatAt: NOW as never, late: { since: NOW as never } } };
out("news late feed", headerLines(late, "squeal", "news").join("\n"));
out("news late feed + runner part pending", headerLines({ ...late, runnerPartPending: true, listingRunners: ["Vitest"] }, "squeal", "news").join("\n"));
out("full late feed", headerLines(late, "squeal").join("\n"));

// ---- 5. words
const owedDelta: Delta = { header: base, entries: [], stillFailing: [], countsOwed: { lookupOnly: true } } as unknown as Delta;
out("news, counts owed after listing (lookup-only)", formatDelta(owedDelta));
out("news plain (main, before W1)", headerLines({ ...base, changedPaths: ["src/a.ts"] as never }, "squeal", "news").join("\n"));
out("sawEditLine", sawEditLine(9));
out("sawEditLine quiet", sawEditLine(9, quietEditsText("squeal")));
out("settledLine", settledLine({ since: 4, files: 2, unknown: 0 }));
out("sawSettledLine", sawSettledLine({ files: 2, unknown: 0 }));

// ---- extra before cases
out("registration unlisted, no daemon", formatRegistration(reg({ ...unlisted, daemon: { state: "down", since: null } as never })));
const ledger: Coverage = { ...runnerCoverage(readPolicy(`${root}/evals/ledgerline` as never), `${root}/evals/ledgerline` as never), slow: { files: 1 } };
out("primer ledgerline (eval fixture) squeal", primer("squeal", ledger));
out("primer ledgerline a8 (requireSlowSuite) squeal", primer("squeal", { ...ledger, slow: { files: 1, requireSlowSuite: true } }));

// ---- after drafts: the primer by sentence replacement on the real output (lengths only)
const ARRIVAL_OLD = "a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working;";
const ARRIVAL_NEW = "a SQUEAL message with your next tool call means a check changed, such as a new failure or a recovery; a test that keeps passing stays silent, so keep working;";
const RUN_OLD = "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.";
const RUN_NEW = "Run tests yourself only when no daemon is validating, when a test file stays unknown after Squeal ran it, or when the repository's own gate requires it.";
const WAIT = /Wait only when you need a result.*?(?:run --all --wait`|status --wait 60000`)\./;
const waitNew = (cmd: string) =>
  cmd === "squeal"
    ? "Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed, and `squeal status --wait 60000` before you finish."
    : `Wait only when you need a result before your next step: \`${cmd} status --wait 60000 <path>...\` for the verdict on files you just changed, and the CLI's \`status --wait 60000\` before you finish.`;
const after = (cmd: string, cov: Coverage) => {
  const before = primer(cmd, cov);
  const text = before.replace(ARRIVAL_OLD, ARRIVAL_NEW).replace(RUN_OLD, RUN_NEW).replace(WAIT, waitNew(cmd));
  return { before, text, arrival: before.includes(ARRIVAL_OLD), run: before.includes(RUN_OLD), wait: WAIT.test(before) };
};
for (const [name, cov] of [["default", DEFAULT], ["cezar", CEZAR], ["slow-on", SLOW], ["ledgerline", ledger], ["ledgerline a8", { ...ledger, slow: { files: 1, requireSlowSuite: true } }]] as const) {
  for (const cmd of ["squeal", CODEX]) {
    const a = after(cmd, cov);
    console.log(`\n##### AFTER ${name} ${cmd === "squeal" ? "squeal" : "codex"}: before ${a.before.length}, after ${a.text.length} (replaced arrival ${a.arrival}, run ${a.run}, wait ${a.wait})`);
    if (cmd === "squeal") console.log(a.text);
  }
}
