// THROWAWAY probe (011-core/research/backlog-wall-budget.md). One arm: a scratch daemon on one fixture,
// baseline, then `run --all --force` (durations now known), optionally an edit of both quick
// sources `editAt` s into it. Prints JSON: tiers per lane with start, end, files, and the load.
// Usage: node drive.mjs <cli.js> <repo> <scratch> <proto 0|1> <editAt s or -1> <out.json>
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [cli, repo, scratch, proto, editAtArg, out] = process.argv.slice(2);
const editAt = Number(editAtArg);
const env = {
  PATH: process.env.PATH,
  HOME: join(scratch, "home"),
  XDG_RUNTIME_DIR: join(scratch, "run"),
  XDG_CONFIG_HOME: join(scratch, "config"),
  XDG_STATE_HOME: join(scratch, "state"),
  SQUEAL_PROTO_WALL: proto,
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
const load = () => loadavg()[0].toFixed(2);
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
  writeFileSync(join(repo, "src/quick.ts"), "export const quick = 2;\n");
  writeFileSync(join(repo, "node/quick.mjs"), "export const quick = 2;\n");
  edit = Date.now();
  mark("edit");
}
let done = await forced;
mark(`forced done exit ${done.code}`);
// An edit ends the forced checkpoint's wait without a verdict (exit 3): wait again, unforced,
// until a checkpoint completes; the cancelled files are still queued, still forced.
while (done.code !== 0 && Date.now() - t0 < 3_600_000) {
  done = await sqAsync("run", "--all", "--wait", "3600000");
  mark(`checkpoint again exit ${done.code}`);
}
// Let the edit's tiers record if the checkpoint ended first.
await new Promise((r) => setTimeout(r, 5000));
const db = new DatabaseSync(join(repo, ".git/squeal/store.sqlite"), { readOnly: true });
const runs = db
  .prepare("SELECT started_at, ended_at, end_state, test_files FROM runs ORDER BY started_at")
  .all()
  .map((r) => {
    const files = JSON.parse(r.test_files).map((f) => f.path ?? f);
    return {
      lane: files.some((f) => String(f).startsWith("node/")) ? "node-test" : "vitest",
      start: (r.started_at - t0) / 1000,
      end: r.ended_at === null ? null : (r.ended_at - t0) / 1000,
      wall: r.ended_at === null ? null : (r.ended_at - r.started_at) / 1000,
      state: r.end_state,
      files,
    };
  });
db.close();
try { sq("stop"); } catch {}
const result = {
  proto: proto === "1",
  editAt,
  forcedWallS: (done.at - t0) / 1000,
  editDelayS: Object.fromEntries(
    ["vitest", "node-test"].map((lane) => {
      if (edit === null) return [lane, null];
      const quick = lane === "vitest" ? "test/quick.test.ts" : "node/quick.test.mjs";
      const r = runs.find((x) => x.start * 1000 + t0 >= edit && x.files.includes(quick) && x.end !== null);
      return [lane, r ? r.end - (edit - t0) / 1000 : null];
    }),
  ),
  log: log.map((l) => ({ ...l, at: (l.at - t0) / 1000 })),
  checkpointOutput: done.text.slice(-600),
  runs,
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ forcedWallS: result.forcedWallS, editDelayS: result.editDelayS }));
