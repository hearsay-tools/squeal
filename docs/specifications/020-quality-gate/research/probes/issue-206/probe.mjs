// Throwaway research probe for issue 206. Not a product test.
// Usage: node probe.mjs <squeal.mjs> nodaemon|daemon [runs=3]
// Makes a disposable git repository under $TMPDIR, links this repository's
// node_modules (installs nothing), runs `squeal code --base main --json`
// `runs` times on the same bytes, and prints each run's reuse and not-kept lines.
// The `daemon` case starts a Squeal daemon in the fixture first and stops it after.
// INPUTS=1: the base commit declares data/table.json for test/reads.test.ts in `inputs`.
// DAEMON_RUN=1 with `daemon`: the daemon runs test/reads.test.ts between gate runs 1 and 2.
// Children get a scratch HOME and TMPDIR. Stops when one-minute load > CPU count.
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [cli, mode, runsArg] = process.argv.slice(2);
if (!cli || !["nodaemon", "daemon"].includes(mode)) throw new Error("usage: probe.mjs <squeal.mjs> nodaemon|daemon [runs]");
const runs = Number(runsArg ?? 3);
const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
const say = (o) => console.log(JSON.stringify(o));
const loadOk = (step) => {
  const load = loadavg()[0];
  const cpuCount = cpus().length;
  say({ step, at: new Date().toISOString(), load1m: load, cpuCount });
  if (load > cpuCount) { say({ skipped: step, why: "one-minute load exceeds CPU count" }); return false; }
  return true;
};
if (!loadOk("start")) process.exit(77);

const base = mkdtempSync(join(tmpdir(), `issue-206-${mode}-`));
const root = join(base, "repo");
const home = join(base, "home");
const tmp = join(base, "tmp");
for (const d of [root, home, tmp]) mkdirSync(d, { recursive: true });
const env = { PATH: process.env.PATH, HOME: home, TMPDIR: tmp, LANG: "C.UTF-8" };
const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
const git = (...args) => { const r = spawnSync("git", args, { cwd: root, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); };
const sq = (args, timeout = 120000) => {
  const s = Date.now();
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { cwd: root, env, encoding: "utf8", timeout });
  return { ...r, ms: Date.now() - s };
};

put("package.json", JSON.stringify({ name: "issue-206-throwaway", private: true, type: "module" }));
put(".gitignore", "node_modules/\n");
put("vitest.config.ts", 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1 } });\n');
put("src/helper.ts", "export function value(): number { return 1; }\n");
// INPUTS=1: the base commit declares the run-time read in squeal.config.json.
if (process.env.INPUTS) put("squeal.config.json", JSON.stringify({ inputs: { "test/reads.test.ts": ["data/table.json"] } }) + "\n");
// A tracked file the test reads at run time, never imports.
put("data/table.json", JSON.stringify({ rows: [1, 2, 3] }) + "\n");
put("test/reads.test.ts", `import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { value } from "../src/helper";
it("reads a tracked data file at run time", () => {
  const table = JSON.parse(readFileSync(new URL("../data/table.json", import.meta.url), "utf8"));
  expect(table.rows.length * value()).toBe(3);
});
`);
put("test/plain.test.ts", `import { it, expect } from "vitest";
import { value } from "../src/helper";
it("imports only", () => { expect(value()).toBe(1); });
`);
symlinkSync(resolve(repo, "node_modules"), join(root, "node_modules"), "dir");
git("init", "-q", "-b", "main");
git("add", ".");
git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "base");
// The change both tests load, so the gate selects both.
put("src/helper.ts", "export function value(): number { return 2 - 1; }\n");
say({ version: sq(["--version"]).stdout.trim(), cli, mode, fixture: root });

let daemon = false;
try {
  if (mode === "daemon") {
    if (!loadOk("daemon-start")) process.exit(77);
    const s = sq(["start"]);
    daemon = true;
    say({ cmd: "squeal start", exit: s.status, ms: s.ms, out: (s.stdout + s.stderr).trim().split("\n").slice(-3) });
    const w = sq(["status", "--wait", "30000"], 60000);
    say({ cmd: "squeal status --wait 30000", exit: w.status, ms: w.ms, out: (w.stdout + w.stderr).trim().split("\n").slice(0, 4) });
  }
  for (let i = 1; i <= runs; i++) {
    if (i === 2 && daemon && process.env.DAEMON_RUN) {
      // Variant: the serving daemon runs the run-time reader once, so its record merges the reads.
      const d = sq(["run", "tests", "test/reads.test.ts", "--wait", "60000"], 90000);
      say({ cmd: "squeal run tests test/reads.test.ts --wait 60000", exit: d.status, ms: d.ms, out: (d.stdout + d.stderr).trim().split("\n").slice(0, 3) });
    }
    if (!loadOk(`gate-${i}`)) break;
    const args = ["code", "--base", "main", "--json", "--timeout", "60"];
    const r = sq(args, 90000);
    let report = null;
    try { report = JSON.parse(r.stdout); } catch {}
    const files = (report?.runs ?? []).flatMap((x) => (x.selected ?? []).map((p) => ({ p, from: x.from?.[p] ?? null })));
    say({
      run: i,
      cmd: `squeal ${args.join(" ")}`,
      exit: r.status,
      ms: r.ms,
      verdict: report?.verdict,
      runs: report?.runs?.map(({ runner, selected, from }) => ({ runner, selected, from })),
      stderr: r.stderr.split("\n").filter((l) => /stores|kept|daemon/i.test(l)),
    });
    void files;
  }
} finally {
  if (daemon) { const s = sq(["stop"]); say({ cmd: "squeal stop", exit: s.status, out: (s.stdout + s.stderr).trim().split("\n").slice(-2) }); }
  if (!process.env.KEEP) rmSync(base, { recursive: true, force: true });
  else say({ kept: base });
}
