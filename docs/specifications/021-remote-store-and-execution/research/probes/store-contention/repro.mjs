// Throwaway (row 021-03). Several real daemons on one fixture clone's store,
// edits, and the one-shot CLI writers of the open lock issues, while
// lock-watch.mjs names every write-lock holder. Run from the repository root:
//   node repro.mjs <squeal.mjs> <worktrees, max 6> <phase seconds> [standin]
// "standin" adds phase B: a process that holds BEGIN IMMEDIATE for 1.5 s every
// 3 s, the hook hand-off hold lock-watch saw on the live host.
// Skips when the one-minute load is at or above the CPU count. Everything lives
// under $TMPDIR/sc-repro (HOME too) and is removed at the end.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const [cliArg, nArg = "4", phaseArg = "60", standin] = process.argv.slice(2);
const host = { at: new Date().toISOString(), load: loadavg().map((l) => l.toFixed(2)), cpus: cpus().length, node: process.version };
console.log(JSON.stringify({ host }));
if (loadavg()[0] >= cpus().length) { console.log(JSON.stringify({ skipped: "one-minute load at or above CPU count" })); process.exit(0); }
const N = Math.min(6, Number(nArg));
const PHASE = Number(phaseArg) * 1000;
const repo = process.cwd();
const cli = resolve(cliArg);
const here = new URL(".", import.meta.url).pathname;
const scratch = join(process.env.TMPDIR ?? "/tmp", "sc-repro");
rmSync(scratch, { recursive: true, force: true });
const main = join(scratch, "wt0");
mkdirSync(main, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|GIT_|CLAUDE|CODEX|PI_|OPENCODE|SQUEAL)/.test(k) && !["NODE_OPTIONS", "NODE_PATH"].includes(k)));
Object.assign(env, { HOME: join(scratch, "home"), XDG_RUNTIME_DIR: join(scratch, "run"), XDG_CONFIG_HOME: join(scratch, "config"), XDG_STATE_HOME: join(scratch, "state"), XDG_DATA_HOME: join(scratch, "data") });
for (const d of [env.HOME, env.XDG_RUNTIME_DIR]) mkdirSync(d, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
const t0 = Date.now();
const log = (o) => console.log(JSON.stringify({ t: ((Date.now() - t0) / 1000).toFixed(1), ...o }));

function run(cwd, args, extra = {}) {
  const started = Date.now();
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], ...extra });
  let out = "", err = "";
  child.stdout?.on("data", (b) => (out += b));
  child.stderr?.on("data", (b) => (err += b));
  return { child, done: new Promise((r) => child.on("exit", (code, signal) => r({ code, signal, out, err, ms: Date.now() - started }))) };
}

// Fixture: 24 source files, 24 test files of 20 tests each.
const w = (root, name, text) => writeFileSync(join(root, name), text);
w(main, "package.json", JSON.stringify({ type: "module", devDependencies: { vitest: "5.0.3" } }));
w(main, ".gitignore", "node_modules/\n");
w(main, "vitest.config.ts", "import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['*.test.ts'],maxWorkers:1}});\n");
w(main, "squeal.config.json", JSON.stringify({ baseline: { onStart: "lookup-then-run-missing" }, complexity: { enabled: false }, coverage: { enabled: false } }));
for (let i = 0; i < 24; i++) {
  w(main, `s${i}.ts`, `export const v${i} = 0;\n`);
  const tests = Array.from({ length: 20 }, (_, j) => `test('t${j}', () => { expect(v${i} + ${j}).toBe(${j}); });`).join("\n");
  w(main, `s${i}.test.ts`, `import {test,expect} from 'vitest'; import {v${i}} from './s${i}';\n${tests}\n`);
}
git(main, "init", "-q");
git(main, "add", ".");
git(main, "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "fixture");
const roots = [main];
for (let k = 1; k < N; k++) {
  const r = join(scratch, `wt${k}`);
  git(main, "worktree", "add", "-q", "-b", `b${k}`, r);
  roots.push(r);
}
for (const r of roots) symlinkSync(join(repo, "node_modules"), join(r, "node_modules"), "dir");

const daemons = [];
let watcher;
const failures = [];
const calls = [];
try {
  for (const r of roots) daemons.push(run(r, ["daemon", r]));
  await sleep(1500);
  const store = join(main, ".git/squeal/store.sqlite");
  watcher = spawn(process.execPath, [join(here, "lock-watch.mjs"), String((PHASE * 2 + 120_000) / 1000), "10", store], { stdio: ["ignore", "pipe", "inherit"] });
  let holds = "";
  watcher.stdout.on("data", (b) => (holds += b));
  log({ phase: "start", worktrees: N, cli, version: (await run(main, ["--version"]).done).out.trim() });

  let edit = 0;
  async function cliLoop(until, phase) {
    const kinds = ["hold", "stop-start", "status", "retry"];
    let i = 0;
    while (Date.now() < until) {
      const r = roots[i % roots.length];
      const kind = kinds[i % kinds.length];
      i++;
      // An edit in two worktrees each round keeps revisions and tiers coming.
      for (const e of [edit, edit + 1]) { const rr = roots[e % roots.length]; const f = e % 24; w(rr, `s${f}.ts`, `export const v${f} = 0; // ${Date.now()}\n`); }
      edit += 2;
      const steps = kind === "hold" ? [["hold", "--max", "1m", "--", "true"]]
        : kind === "stop-start" ? [["stop", "--until-start", r], ["start"]]
        : kind === "status" ? [["status", "--json"]]
        : [["retry", "s1.test.ts", "--reason", "load"]];
      for (const args of steps) {
        const res = await run(r, args).done;
        const text = res.err + (kind === "status" ? "" : res.out);
        const locked = /locked|busy|could not/i.test(text);
        calls.push({ phase, cmd: args[0], ms: res.ms, code: res.code, locked });
        if (locked || (res.code !== 0 && kind !== "retry")) { failures.push({ phase, cmd: args.join(" "), code: res.code, ms: res.ms, text: text.split("\n").filter((l) => /locked|busy|could not|error/i.test(l)).slice(0, 3) }); log(failures.at(-1)); }
      }
      await sleep(1000);
    }
  }
  log({ phase: "A", what: "daemons, edits and CLI writers" });
  await cliLoop(Date.now() + PHASE, "A");
  let stop = false, standinHolds = 0, standinBusy = 0;
  if (standin === "standin") {
    log({ phase: "B", what: "phase A plus a 1.5 s BEGIN IMMEDIATE every 3 s (hook stand-in)" });
    const db = new DatabaseSync(store);
    db.exec("PRAGMA busy_timeout = 2000");
    const loop = (async () => {
      while (!stop) {
        try { db.exec("BEGIN IMMEDIATE"); standinHolds++; await sleep(1500); db.exec("COMMIT"); } catch { standinBusy++; try { db.exec("ROLLBACK"); } catch {} }
        await sleep(1500);
      }
    })();
    await cliLoop(Date.now() + PHASE, "B");
    stop = true; await loop; db.close();
  }
  // What the daemons recorded: busy notes and lock errors, from the fixture's store.
  const ro = new DatabaseSync(store, { readOnly: true });
  ro.exec("PRAGMA busy_timeout = 5000");
  const notes = ro.prepare("SELECT value FROM meta WHERE key LIKE '%notes%'").all().flatMap((r) => { try { return JSON.parse(r.value); } catch { return []; } }).map((n) => n.text).filter((t) => /busy|locked/i.test(t));
  ro.close();
  for (const r of roots) await run(r, ["stop", r]).done;
  await sleep(1000);
  watcher.kill("SIGTERM");
  await sleep(300);
  const hs = holds.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byCmd = {};
  for (const c of calls) { const k = `${c.phase} ${c.cmd}`; const e = (byCmd[k] ??= { n: 0, locked: 0, maxMs: 0 }); e.n++; if (c.locked) e.locked++; e.maxMs = Math.max(e.maxMs, c.ms); }
  const holders = {};
  for (const h of hs) { const k = h.cmd.includes(" daemon ") ? "daemon" : h.cmd.replace(/.*squeal\.mjs /, "cli ").split(" ").slice(0, 2).join(" "); const e = (holders[k] ??= { holds: 0, ms: 0, max: 0, over1s: 0 }); e.holds++; e.ms += h.ms; e.max = Math.max(e.max, h.ms); if (h.ms >= 1000) e.over1s++; }
  log({ summary: { calls: byCmd, failures: failures.length, standinHolds, standinBusy, notes, holders, load: loadavg().map((l) => l.toFixed(2)) } });
  writeFileSync(join(here, "out", `repro-holds-${standin ?? "a"}.jsonl`), holds);
} finally {
  for (const d of daemons) d.child.kill("SIGTERM");
  await sleep(2000);
  for (const d of daemons) if (d.child.exitCode === null) d.child.kill("SIGKILL");
  watcher?.kill("SIGKILL");
  rmSync(scratch, { recursive: true, force: true });
  log({ cleaned: scratch });
}
