#!/usr/bin/env node
// Throwaway probe for 019-17. Not product code. Runs as agent; writes as squeal-e2e.
//   node configs.mjs <case root> <as-e2e.mjs>   > bases.json
// One branch per configuration variant, each one commit on `dogfood` that writes
// squeal.config.json, and prints {variant: {repo, branch, commit}}:
//   cez-today   cezarion's own squeal.config.json, unchanged (the control, spec 019 Goal 2)
//   cez-groups  the same plus `checks`: its e2e browser project at stop after the unit
//               projects, every other Vitest project (the four unit projects) at edit, lint at
//               commit; Stop holds once (the default)
//   fix-h1      the Part A fixture's three groups (test/e2e/run-triggers-fixture.ts), oxlint on
//               src/**, stop.maxHolds 1
//   fix-h2      the same with stop.maxHolds 2
import { execFileSync } from "node:child_process";

const [R, asE2e] = process.argv.slice(2);
const as = (repo, ...args) =>
  execFileSync("node", [asE2e, R, `${R}/${repo}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
const head = (repo) => as(repo, "git", "rev-parse", "dogfood");

const GROUPS = [
  { name: "e2e", runner: "vitest", project: "e2e", at: "stop", after: ["unit"], limits: { maxParallel: 1 } },
  { name: "unit", runner: "vitest", project: "unit", at: "edit" },
  { name: "lint", lint: true, at: "commit" },
];
const CEZ_GROUPS = [
  { name: "e2e", runner: "vitest", project: "e2e", at: "stop", after: ["unit"], limits: { maxParallel: 1 } },
  { name: "unit", runner: "vitest", at: "edit" },
  { name: "lint", lint: true, at: "commit" },
];
const FIX_LINT = { enabled: true, tools: ["oxlint"], include: ["src/**"] };

const bases = {};
const variant = (name, repo, from, edit) => {
  as(repo, "git", "checkout", "-q", "-B", name, from);
  if (edit !== null) {
    const now = JSON.parse(as(repo, "sh", "-c", "cat squeal.config.json 2>/dev/null || echo '{}'"));
    const text = `${JSON.stringify(edit(now), null, 2)}\n`;
    as(repo, "node", "-e", "require('fs').writeFileSync('squeal.config.json', process.argv[1])", text);
    as(repo, "git", "add", "squeal.config.json");
    as(repo, "git", "commit", "-q", "-m", `dogfood 019-17: ${name}`);
  }
  bases[name] = { repo, branch: name, commit: as(repo, "git", "rev-parse", "HEAD") };
};

const cez = head("cezarion");
const fix = head("fixture");
variant("cez-today", "cezarion", cez, null);
variant("cez-groups", "cezarion", cez, (c) => ({ ...c, checks: CEZ_GROUPS }));
variant("fix-h1", "fixture", fix, () => ({ lint: FIX_LINT, checks: GROUPS, stop: { maxHolds: 1 } }));
variant("fix-h2", "fixture", fix, () => ({ lint: FIX_LINT, checks: GROUPS, stop: { maxHolds: 2 } }));
as("cezarion", "git", "checkout", "-q", "dogfood");
as("fixture", "git", "checkout", "-q", "dogfood");
console.log(JSON.stringify(bases, null, 2));
