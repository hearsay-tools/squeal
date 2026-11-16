// Throwaway: the drafted primer (primer-after.ts) for each coverage, with what it dropped.
process.env.TZ = "UTC";
import { readPolicy } from "../../../../../../src/core/daemon/policy.js";
import { runnerCoverage } from "../../../../../../src/runners/descriptions.js";
import { DEFAULT_COVERAGE, type Coverage } from "../../../../../../src/harness/shared/coverage.js";
import { primer as before } from "../../../../../../src/harness/shared/primer.js";
import { codexCommand } from "../../../../../../src/harness/codex/command.js";
import { primer as after } from "./primer-after.js";

const root = process.cwd();
const own = runnerCoverage(readPolicy(root as never), root as never);
const lroot = `${root}/evals/ledgerline`;
const ledger = runnerCoverage(readPolicy(lroot as never), lroot as never);
const CEZAR: Coverage = {
  ...DEFAULT_COVERAGE, vitest: true,
  nodeTest: [
    { name: "test:unit", include: ["packages/cezar/test/unit/*.test.ts"] },
    { name: "root:test:unit", include: [".github/scripts/*.test.cjs", "scripts/*.test.mjs", ".ai/skills/*/scripts/*.test.mjs"] },
  ],
  slow: { files: 0, requireSlowSuite: false },
  groups: { moments: [ { at: "edit", names: ["lint", "tests"] }, { at: "pause", names: ["run-loop"] }, { at: "manual", names: ["browser"] } ] },
};
const cases: [string, Coverage][] = [
  ["default (this repository)", { ...own, slow: null }],
  ["cezar", CEZAR],
  ["slow-on (this repository, 3 slow files, requireSlowSuite)", { ...own, slow: { files: 3, requireSlowSuite: true } }],
  ["ledgerline (eval fixture)", { ...ledger, slow: { files: 1 } }],
  ["ledgerline a8 (requireSlowSuite)", { ...ledger, slow: { files: 1, requireSlowSuite: true } }],
  ["no test group at edit", { ...CEZAR, groups: { moments: [ { at: "stop", names: ["lint", "unit"] }, { at: "manual", names: ["browser"] } ], noTestsAtEdit: true } }],
];
const CODEX = codexCommand({ PLUGIN_ROOT: "~/.codex/plugins/cache/squeal/squeal/0.1.531" }, "/unused.mjs");
const has = (t: string) => ({
  pathWait: t.includes("status --wait 60000 <path>...") || t.includes("<group> <path>..."),
  slowArrival: t.includes("A slow failure"),
  retry: t.includes("--reason load|environment"),
  runYourself: t.includes("Run tests yourself"),
  revision: t.includes("A revision is"),
  cliNamedAtWait: !t.includes("on the CLI SQUEAL messages name"),
});
for (const [name, cov] of cases) {
  for (const [cli, cmd] of [["squeal", "squeal"], ["codex", CODEX]] as const) {
    const b = before(cmd, cov), a = after(cmd, cov);
    console.log(`\n##### ${name}, ${cli}: before ${b.length}, after ${a.length}`);
    console.log(`  before ${JSON.stringify(has(b))}\n  after  ${JSON.stringify(has(a))}`);
    if (cli === "squeal") console.log(a);
  }
}
