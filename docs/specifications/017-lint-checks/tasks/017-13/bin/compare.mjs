#!/usr/bin/env node
// Throwaway probe for 017-13. Not product code. Runs as squeal-e2e, cwd the clone.
//   node compare.mjs <out dir> [--ignore-pattern <glob>]... [-- <path>...]
// One fresh ESLint CLI run (`node node_modules/eslint/bin/eslint.js -f json`, the worker's own
// resolution, no pnpm bin shim) over `.` or the given paths, timed with /usr/bin/time, then each
// file's findings compared with what Squeal holds: every state in lint.sqlite (outcome) and, for
// failing files, `squeal lint --json`'s findings. Findings compare as multisets of
// `rule|message` (ESLint's fatal parse errors have no rule). Writes cli.json, time.txt and
// compare.json to <out dir>; prints the summary.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const out = argv.shift();
const dash = argv.indexOf("--");
const opts = dash >= 0 ? argv.slice(0, dash) : argv;
const paths = dash >= 0 ? argv.slice(dash + 1) : ["."];
mkdirSync(out, { recursive: true });
const root = process.cwd();
const cliOut = `${out}/cli.json`;
try {
  execFileSync(
    "/usr/bin/time",
    ["-f", "wall %e s user %U s sys %S s maxrss %M KB", "-o", `${out}/time.txt`, "node", "node_modules/eslint/bin/eslint.js", "-f", "json", "-o", cliOut, ...opts, ...paths],
    { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1 << 28 },
  );
} catch (e) {
  // exit 1 means findings; anything else is reported
  if (e.status !== 1) {
    writeFileSync(`${out}/cli-error.txt`, String(e.stderr ?? e));
    console.log(JSON.stringify({ cliExit: e.status, error: String(e.stderr ?? e).split("\n").slice(0, 6).join(" | ") }));
    process.exit(0);
  }
}
const cli = JSON.parse(readFileSync(cliOut, "utf8"));
const key = (rule, message) => `${rule ?? ""}|${message}`;
const bag = (list) => list.map((x) => x).sort();
const cliBy = new Map(cli.map((f) => [relative(root, f.filePath), bag(f.messages.map((m) => key(m.ruleId, m.message)))]));
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
const db = new DatabaseSync(`${common}/squeal/lint.sqlite`, { readOnly: true });
const states = new Map(
  db.prepare("SELECT c.path, s.outcome, s.stale, s.reason FROM states s JOIN checks c ON c.id = s.check_id").all().map((r) => [r.path, r]),
);
const lint = JSON.parse(execFileSync("squeal", ["lint", "--json"], { encoding: "utf8", maxBuffer: 1 << 28 }));
const sqBy = new Map(lint.files.map((f) => [f.path, bag((f.findings ?? []).map((m) => key(m.rule, m.message)))]));
const inScope = (p) => paths.includes(".") || paths.some((q) => p === q || p.startsWith(`${q.replace(/\/$/, "")}/`));
const ignored = opts.filter((_, i) => opts[i - 1] === "--ignore-pattern").map((g) => new RegExp(`^${g.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`));
const summary = { cliFiles: cliBy.size, squealStates: 0, same: 0, onlyCli: [], onlySqueal: [], differ: [], unknownSquealPassCli: [], unknownSquealFailCli: [] };
for (const [p, s] of states) {
  if (!inScope(p) || ignored.some((r) => r.test(p))) continue;
  summary.squealStates++;
  const c = cliBy.get(p);
  if (c === undefined) {
    summary.onlySqueal.push({ path: p, outcome: s.outcome });
    continue;
  }
  if (s.outcome === "unknown") {
    (c.length === 0 ? summary.unknownSquealPassCli : summary.unknownSquealFailCli).push({ path: p, reason: s.reason, cli: c });
    continue;
  }
  const q = s.outcome === "pass" ? [] : (sqBy.get(p) ?? null);
  if (q !== null && JSON.stringify(q) === JSON.stringify(c)) summary.same++;
  else summary.differ.push({ path: p, outcome: s.outcome, stale: s.stale, squeal: q, cli: c });
}
for (const p of cliBy.keys()) if (!states.has(p)) summary.onlyCli.push({ path: p, cli: cliBy.get(p) });
summary.time = readFileSync(`${out}/time.txt`, "utf8").trim();
writeFileSync(`${out}/compare.json`, `${JSON.stringify(summary, null, 2)}\n`);
const brief = { ...summary };
for (const k of ["onlyCli", "onlySqueal", "differ", "unknownSquealPassCli", "unknownSquealFailCli"]) brief[k] = summary[k].length;
console.log(JSON.stringify(brief));
