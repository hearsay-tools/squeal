// THROWAWAY probe (011-core/research/streaming-lanes.md). One arm: a scratch daemon on one fixture
// (scratch HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, XDG_STATE_HOME; the store in the fixture's own
// .git/squeal), a baseline, then `run --all --force --wait` with every duration known and, when
// editAt >= 0, an edit of node/quick.mjs editAt s into it. Dumps the store's runs as JSON with
// the one-minute load sampled every 5 s.
// Usage: node drive.mjs <cli.mjs> <repo> <scratch> <arm: today|w1|stream|stream-over> <editAt s or -1> <out.json>
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [cli, repo, scratch, arm, editAtArg, out] = process.argv.slice(2);
const editAt = Number(editAtArg);
const env = {
  PATH: process.env.PATH,
  HOME: join(scratch, "home"),
  XDG_RUNTIME_DIR: join(scratch, "run"),
  XDG_CONFIG_HOME: join(scratch, "config"),
  XDG_STATE_HOME: join(scratch, "state"),
  SQUEAL_PROTO: arm,
  // The second prototype build's variants: an edit's cancel in node:test, an edit's tier beside.
  ...(process.env.SQUEAL_PROTO_CANCEL ? { SQUEAL_PROTO_CANCEL: process.env.SQUEAL_PROTO_CANCEL } : {}),
  ...(process.env.SQUEAL_PROTO_BESIDE ? { SQUEAL_PROTO_BESIDE: process.env.SQUEAL_PROTO_BESIDE } : {}),
};
for (const d of ["home", "run", "config", "state"]) mkdirSync(join(scratch, d), { recursive: true, mode: 0o700 });
const sq = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: repo, env, encoding: "utf8" });
const sqAsync = (...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: repo, env });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("exit", (code) => resolve({ code, text, at: Date.now() }));
  });
const load = () => Number(loadavg()[0].toFixed(2));
const loads = [];
const sampler = setInterval(() => loads.push(load()), 5000);
const log = [];
const mark = (what) => log.push({ what, at: Date.now(), load: load() });

mark("start");
sq("start");
const base = await sqAsync("run", "--all", "--wait", "1800000");
mark(`baseline done exit ${base.code}`);
const t0 = Date.now();
mark("force");
const forced = sqAsync("run", "--all", "--force", "--wait", "3600000");
let edit = null;
if (editAt >= 0) {
  await new Promise((r) => setTimeout(r, editAt * 1000));
  writeFileSync(join(repo, "node/quick.mjs"), `export const quick = ${Date.now()};\n`);
  edit = Date.now();
  mark("edit");
}
let done = await forced;
mark(`forced done exit ${done.code}`);
while (done.code !== 0 && Date.now() - t0 < 3_600_000) {
  done = await sqAsync("run", "--all", "--wait", "3600000");
  mark(`checkpoint again exit ${done.code}`);
}
await new Promise((r) => setTimeout(r, 5000));
clearInterval(sampler);
const db = new DatabaseSync(join(repo, ".git/squeal/store.sqlite"), { readOnly: true });
const runs = db
  .prepare("SELECT started_at, ended_at, end_state, test_files FROM runs ORDER BY started_at")
  .all()
  .map((r) => ({
    start: (r.started_at - t0) / 1000,
    end: r.ended_at === null ? null : (r.ended_at - t0) / 1000,
    state: r.end_state,
    files: JSON.parse(r.test_files).map((f) => f.path ?? f),
  }));
db.close();
try { sq("stop"); } catch {}
const quick = edit === null ? null : runs.find((x) => x.start * 1000 + t0 >= edit && x.files.includes("node/quick.test.mjs"));
const result = {
  arm,
  cancel: process.env.SQUEAL_PROTO_CANCEL ?? null,
  beside: process.env.SQUEAL_PROTO_BESIDE === "1",
  editAt,
  baselineExit: base.code,
  forcedWallS: (done.at - t0) / 1000,
  edit: quick ? { startAfterS: quick.start - (edit - t0) / 1000, currentAfterS: quick.end - (edit - t0) / 1000 } : null,
  load: { min: Math.min(...loads), max: Math.max(...loads), marks: log.map((l) => ({ ...l, at: (l.at - t0) / 1000 })) },
  checkpointOutput: done.text.slice(-400),
  runs,
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ arm, forcedWallS: result.forcedWallS, edit: result.edit, load: [result.load.min, result.load.max], runs: runs.length }));
