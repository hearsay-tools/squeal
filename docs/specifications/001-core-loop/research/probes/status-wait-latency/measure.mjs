// Throwaway probe for 001-172. One sample: edit one file in a scratch clone,
// start `squeal status --wait` at once, and poll the clone's store read-only
// for the time of each stage. Appends one JSON line to --out.
//
// node measure.mjs --root <clone> --test <rel test file> --edit <rel file>
//   --mode red|green|neutral --case <label> --out <file.jsonl> [--wait-ms 900000]
// red: appends a top-level throw (PASS -> FAIL of the file-level check, news);
// green: restores the saved original (FAIL -> PASS, news);
// neutral: appends a comment (key moves, PASS -> PASS, no news).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    root: { type: "string" },
    test: { type: "string" },
    edit: { type: "string" },
    mode: { type: "string" },
    case: { type: "string" },
    out: { type: "string" },
    "wait-ms": { type: "string", default: "900000" },
    squeal: { type: "string", default: "/tmp/sq172/plugin/bin/squeal" },
    clean: { type: "string", default: "/tmp/sq172/clean.sh" },
  },
});
const root = realpathSync(a.root);
const wt = createHash("sha256").update(root).digest("hex").slice(0, 16);
const db = new DatabaseSync(join(root, ".git/squeal/store.sqlite"), { readOnly: true });
db.exec("PRAGMA busy_timeout = 2000");
const editPath = join(root, a.edit);
const savedPath = join("/tmp/sq172/saved", createHash("sha256").update(editPath).digest("hex"));

const q = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const maxRev = () => one("SELECT max(number) n FROM revisions WHERE worktree_id = ?", wt).n ?? 0;
const refined = () => Number(one("SELECT value FROM meta WHERE key = ?", `refined.${wt}`)?.value ?? -1);
const pendingCounts = () =>
  Object.fromEntries(
    q("SELECT coalesce(pending,'none') p, count(*) n FROM test_file_keys WHERE worktree_id = ? GROUP BY 1", wt).map(
      (r) => [r.p, r.n],
    ),
  );
const runsInFlight = () =>
  q("SELECT id, test_files, started_at FROM runs WHERE worktree_id = ? AND ended_at IS NULL", wt).map((r) => ({
    files: JSON.parse(r.test_files).length,
    startedAt: r.started_at,
  }));

// Before: state of the queue.
const startRev = maxRev();
const before = { revision: startRev, refined: refined(), pending: pendingCounts(), inFlight: runsInFlight() };
const original = existsSync(savedPath) ? readFileSync(savedPath, "utf8") : readFileSync(editPath, "utf8");
mkdirSync("/tmp/sq172/saved", { recursive: true });
if (!existsSync(savedPath)) writeFileSync(savedPath, original);
const current = readFileSync(editPath, "utf8");
const next =
  a.mode === "red"
    ? `${original}\nthrow new Error("squeal probe 001-172 red ${Date.now()}");\n`
    : a.mode === "green"
      ? original
      : `${current}\n// squeal probe 001-172 ${Date.now()}\n`;

const load0 = loadavg()[0];
const t0 = Date.now();
writeFileSync(editPath, next);
const wait = new Promise((resolve) => {
  const p = spawn(a.clean, [root, a.squeal, "status", "--json", "--wait", a["wait-ms"]], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (err += d));
  p.on("close", () => {
    const at = Date.now();
    let json = null;
    try {
      json = JSON.parse(out);
    } catch {}
    resolve({ at, line: err.trim().split("\n").at(-1), outcome: json?.wait?.outcome ?? null, revision: json?.revision });
  });
});

const seen = {};
let returned = null;
wait.then((r) => (returned = r));
const deadline = t0 + Number(a["wait-ms"]) + 30_000;
let loadMax = load0;
for (;;) {
  const now = Date.now();
  loadMax = Math.max(loadMax, loadavg()[0]);
  if (seen.revision === undefined) {
    const r = one(
      "SELECT number, created_at, trigger FROM revisions WHERE worktree_id = ? AND number > ? AND changes LIKE ? ORDER BY number LIMIT 1",
      wt,
      startRev,
      `%${a.edit}%`,
    );
    if (r) seen.revision = { number: r.number, createdAt: r.created_at, trigger: r.trigger, observedAt: now };
  }
  if (seen.revision && seen.refinedAt === undefined && refined() >= seen.revision.number) seen.refinedAt = now;
  if (seen.revision && seen.queuedAt === undefined) {
    const k = one("SELECT pending, revision FROM test_file_keys WHERE worktree_id = ? AND path = ?", wt, a.test);
    if (k?.pending) seen.queuedAt = now;
  }
  if (seen.revision && !seen.run) {
    const r = one(
      "SELECT id, started_at, test_files, checkpoint_id FROM runs WHERE worktree_id = ? AND started_at >= ? AND test_files LIKE ? ORDER BY started_at LIMIT 1",
      wt,
      t0,
      `%"${a.test}"%`,
    );
    if (r) seen.run = { id: r.id, startedAt: r.started_at, files: JSON.parse(r.test_files).length, checkpoint: r.checkpoint_id };
  }
  if (seen.run && seen.run.endedAt === undefined) {
    const r = one("SELECT ended_at, end_state, log_dir FROM runs WHERE id = ?", seen.run.id);
    if (r?.ended_at) {
      seen.run.endedAt = r.ended_at;
      seen.run.end = r.end_state;
      try {
        const reportPath = join(r.log_dir, "report.json");
        const report = JSON.parse(readFileSync(reportPath, "utf8")).report;
        seen.run.reportMs = report.durationMs;
        seen.run.reportWrittenAt = Math.round(statSync(reportPath).mtimeMs);
        seen.run.fileMs = report.fileDurations?.find?.((f) => f.testFile?.path === a.test)?.durationMs ?? null;
      } catch (e) {
        seen.run.reportError = String(e);
      }
    }
  }
  if (seen.run?.endedAt && seen.storedAt === undefined) {
    const r = one(
      "SELECT min(r.recorded_at) at FROM results r JOIN checks c ON c.id = r.check_id WHERE c.test_path = ? AND r.run_id = ?",
      a.test,
      seen.run.id,
    );
    seen.storedAt = r?.at ?? null;
  }
  // A lookup hit (restored bytes whose key has a stored result) settles without a run.
  if (seen.revision && !seen.run && seen.hitAt === undefined) {
    const k = one("SELECT pending, revision FROM test_file_keys WHERE worktree_id = ? AND path = ?", wt, a.test);
    if (k && k.pending === null && k.revision >= seen.revision.number && seen.refinedAt !== undefined) seen.hitAt = now;
  }
  const settled = seen.run?.endedAt !== undefined || seen.hitAt !== undefined || now > deadline;
  if (returned && settled) break;
  if (now > deadline) break;
  await new Promise((r) => setTimeout(r, 20));
}
// Runs that started between the edit's revision and the target's run, and ran no target:
// the work the edit's own file waited behind.
const ahead = seen.run
  ? q(
      "SELECT started_at, ended_at, test_files, checkpoint_id FROM runs WHERE worktree_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at",
      wt,
      t0,
      seen.run.startedAt,
    ).map((r) => ({ startedAt: r.started_at, endedAt: r.ended_at, files: JSON.parse(r.test_files).length, checkpoint: r.checkpoint_id !== null }))
  : null;
const rec = {
  case: a.case,
  mode: a.mode,
  test: a.test,
  edit: a.edit,
  root,
  t0,
  load0,
  loadMax,
  before,
  revision: seen.revision ?? null,
  refinedAt: seen.refinedAt ?? null,
  run: seen.run ?? null,
  storedAt: seen.storedAt ?? null,
  hitAt: seen.hitAt ?? null,
  ahead,
  wait: returned,
};
const d = (x, y) => (x == null || y == null ? null : x - y);
rec.stages = {
  watcher: d(rec.revision?.createdAt, t0),
  runnerPart: d(rec.refinedAt, rec.revision?.createdAt),
  queueWait: d(rec.run?.startedAt, rec.refinedAt ?? rec.revision?.createdAt),
  tierStart: d(d(rec.run?.reportWrittenAt, rec.run?.reportMs), rec.run?.startedAt),
  run: rec.run?.reportMs ?? null,
  record: d(rec.storedAt ?? rec.run?.endedAt, rec.run?.reportWrittenAt),
  delivery: d(returned?.at, rec.storedAt ?? rec.run?.endedAt ?? rec.hitAt),
  resultAfterEdit: d(rec.storedAt ?? rec.run?.endedAt ?? rec.hitAt, t0),
  waitReturned: d(returned?.at, t0),
};
appendFileSync(a.out, `${JSON.stringify(rec)}\n`);
console.log(JSON.stringify({ case: rec.case, mode: rec.mode, outcome: returned?.outcome, hit: rec.hitAt !== null, load0, ...rec.stages, ahead: ahead?.length }));
