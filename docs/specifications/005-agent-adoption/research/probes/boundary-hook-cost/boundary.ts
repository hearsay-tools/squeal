// Throwaway probe, row 005-110. Runs the PostToolBatch, Stop or UserPromptSubmit hook's code
// in-process on a store COPY in this task's scratch directory, for a fake session id, and times it
// step by step, with an optional statement-level trace. Never a live store: every SQLite prepare and
// exec checks its database's path first, and the location's common dir is the copy, never the one
// `locate(cwd)` would find. The copy's daemon sockets were rewritten (neuter-copy.mjs), so a "fresh"
// daemon takes no write and answers no request: the hook writes the copy itself.
// Run with node_modules/.bin/tsx (never pnpm exec). Env:
//   SRC      source root to import (this worktree = main 0.1.548, or an extracted 0.1.546)
//   COMMON   the copy's common dir (holds squeal/store.sqlite)
//   ROOT     the real worktree whose id the rows carry (read only: realpath, HEAD, config, git status)
//   SESSION  the fake session id (a random UUID made by the caller)
//   HOOK     register | ptb | stop | ups
//   DAEMON   fresh (the copy's heartbeat set to now before the run, as a live daemon keeps it;
//            its socket answers nothing, so the hook writes the copy itself)
//            | served (as fresh, with SOCKET, a stub-daemon.ts socket, recorded as the daemon's)
//            | stale (left as copied: older than two intervals, so the hook "spawns" a stub)
//   NEWS     0 | 1: before the run, flip one passing state of the worktree to a failure (or back)
//   LOCK     0, or ms a second process holds the copy's write lock from the hook's start
//   TRACE    1: statement trace (adds its own cost); MARKS 1: PostToolBatch mirrored step by step
//   OUT      JSON lines file
import { spawn } from "node:child_process";
import { appendFileSync, openSync } from "node:fs";
import { loadavg } from "node:os";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const env = process.env;
const SRC = env.SRC!, COMMON = env.COMMON!, ROOT = env.ROOT!, SESSION = env.SESSION!;
const HOOK = env.HOOK ?? "ptb", DAEMON = env.DAEMON ?? "fresh";
const LOCK = Number(env.LOCK ?? 0), TRACE = env.TRACE === "1", MARKS = env.MARKS === "1";
const SCRATCH = "/t/cd01ba62/";
if (!COMMON.includes(SCRATCH)) throw new Error("COMMON must be a scratch copy");
if (!/^[0-9a-f-]{36}$/.test(SESSION)) throw new Error("SESSION must be a fresh UUID");

// Guard: no statement on a database outside the scratch directory.
const where = (db: DatabaseSync) => String((db as any).location?.() ?? "");
const guard = (db: DatabaseSync) => {
  const at = where(db);
  if (at !== "" && !at.includes(SCRATCH)) throw new Error(`probe guard: refusing ${at}`);
};
type Stat = { n: number; ms: number; rows: number; db: string };
let trace = new Map<string, Stat>();
const dbOf = new WeakMap<object, string>();
const add = (sql: string, ms: number, rows: number, db = "") => {
  const k = sql.replace(/\s+/g, " ").trim().slice(0, 120);
  const s = trace.get(k) ?? { n: 0, ms: 0, rows: 0, db };
  s.n++; s.ms += ms; s.rows += rows; trace.set(k, s);
};
const origPrepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (this: DatabaseSync, sql: string, ...rest: any[]) {
  guard(this);
  const r = (origPrepare as any).call(this, sql, ...rest);
  if (TRACE) dbOf.set(r, where(this).split("/").pop() ?? "");
  return r;
};
const origExec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (this: DatabaseSync, sql: string) {
  guard(this);
  if (!TRACE) return origExec.call(this, sql);
  const t = performance.now(); const r = origExec.call(this, sql); add("exec: " + sql, performance.now() - t, 0, where(this).split("/").pop()); return r;
};
if (TRACE) for (const m of ["all", "get", "run", "iterate"] as const) {
  const orig = (StatementSync.prototype as any)[m];
  (StatementSync.prototype as any)[m] = function (this: StatementSync, ...a: unknown[]) {
    const t = performance.now(); const r = orig.apply(this, a);
    const rows = m === "all" ? (r as unknown[]).length : m === "get" ? (r ? 1 : 0) : m === "run" ? Number((r as any).changes ?? 0) : 0;
    add((this as any).sourceSQL ?? "?", performance.now() - t, rows, dbOf.get(this) ?? ""); return r;
  };
}

const t00 = performance.now();
const imp = (p: string) => import(pathToFileURL(`${SRC}/src/${p}`).href);
const ptbMod = await imp("harness/claude-code/hooks/post-tool-batch.ts");
const stopMod = await imp("harness/claude-code/hooks/stop.ts");
const upsMod = await imp("harness/claude-code/hooks/user-prompt-submit.ts");
const session = await imp("harness/shared/session.ts");
const handOffMod = await imp("harness/shared/hand-off.ts");
const hook = await imp("harness/shared/hook.ts");
const deliverMod = await imp("harness/shared/deliver.ts");
const ensureMod = await imp("harness/shared/ensure.ts");
const owed = await imp("harness/shared/owed.ts");
const boundary = await imp("core/commit/boundary.ts");
const format = await imp("core/delivery/format.ts");
const uncovered = await imp("harness/shared/uncovered-edit.ts");
const importMs = performance.now() - t00;

const store = `${COMMON}/squeal/store.sqlite`;
const worktreeId = (await imp("core/fs/git-layout.ts")).worktreeIdFor(ROOT);
const version = (() => {
  const db = new DatabaseSync(store, { readOnly: true });
  const v = (db.prepare("SELECT daemon_version v FROM worktrees WHERE id = ?").get(worktreeId) as any)?.v;
  db.close(); return v ?? "0.1.546";
})();

// Setup, untimed, in its own connection, closed before the hook opens the copy.
let flipped: string | null = null;
{
  const db = new DatabaseSync(store);
  db.exec("PRAGMA busy_timeout = 10000");
  // served: the stub daemon's socket in the scratch directory (stub-daemon.ts) takes the writes.
  const socket = DAEMON === "served" ? env.SOCKET! : `/nonexistent/probe-005-110/${worktreeId}.sock`;
  if (!socket.startsWith("/nonexistent/") && !socket.includes(SCRATCH)) throw new Error("SOCKET must be in scratch");
  if (DAEMON === "fresh" || DAEMON === "served") db.prepare("UPDATE worktrees SET daemon_heartbeat_at = ?, daemon_version = ?, daemon_socket = ? WHERE id = ?").run(Date.now(), version, socket, worktreeId);
  if (env.NEWS === "1") {
    const failing = db.prepare("SELECT check_id FROM known_states WHERE worktree_id = ? AND summary = 'probe-005-110'").get(worktreeId) as any;
    if (failing) { db.prepare("UPDATE known_states SET outcome = 'pass', summary = NULL, fingerprint = NULL WHERE worktree_id = ? AND check_id = ?").run(worktreeId, failing.check_id); flipped = "fixed"; }
    else {
      const pick = db.prepare("SELECT check_id FROM known_states WHERE worktree_id = ? AND outcome = 'pass' AND validity = 'current' ORDER BY check_id LIMIT 1").get(worktreeId) as any;
      db.prepare("UPDATE known_states SET outcome = 'fail', summary = 'probe-005-110', fingerprint = 'probe-005-110' WHERE worktree_id = ? AND check_id = ?").run(worktreeId, pick.check_id); flipped = "failed";
    }
  }
  db.close();
}

const devnull = openSync("/dev/null", "w");
let spawned = 0;
const ensureDaemon = async () => {
  spawned++;
  const child = spawn("/bin/sleep", ["3"], { detached: true, stdio: ["ignore", devnull, devnull] });
  child.unref(); return "spawned";
};
const sink = { write: (_t: string, cb: (e?: Error | null) => void) => { cb(null); return true; } };
function lockHolder(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  const child = spawn(process.execPath, [new URL("./lock-holder.mjs", import.meta.url).pathname, store, String(ms)], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((res) => child.stdout!.on("data", (d) => { if (String(d).includes("locked")) res(); }));
}

const location = { root: ROOT, commonDir: COMMON };
const handOff = new handOffMod.HandOff();
const deps = { env: {}, ensureDaemon, handOff, squealVersion: version, command: "squeal", harnessProcess: () => null, cli: "/nonexistent/probe-005-110/squeal.mjs" };
const base = { session_id: SESSION, cwd: ROOT, transcript_path: "/nonexistent/probe-005-110.jsonl" };
await lockHolder(LOCK);
const marks: Record<string, number> = {};
const t0 = performance.now(); let last = t0;
const mark = (k: string) => { const t = performance.now(); marks[k] = +((marks[k] ?? 0) + t - last).toFixed(1); last = t; };
let out: unknown = null; let error: string | null = null;
try {
  if (HOOK === "register") {
    out = await session.startSession({ ...base, source: "startup", hook_event_name: "SessionStart" }, location, deps);
    mark("register");
  } else if (HOOK === "ptb" && MARKS) {
    // deliver() of src/harness/shared/deliver.ts, mirrored with marks (same in 0.1.546 and 0.1.548).
    out = await hook.withContext(base, location, deps, async (context: any) => {
      mark("open");
      const at = Date.now();
      const ensured = await ensureMod.ensureIfStale(context, deps); mark("ensureIfStale");
      const said = hook.isRegistered(context)
        ? await owed.sayOwed(context, deps, { inTurn: true, ...ensureMod.startingAfter(ensured, at) })
        : await owed.registerOwing(context, deps, { primer: true }, { inTurn: true, ...ensureMod.startingAfter(ensured, at) });
      mark("owed");
      if (said !== null) { await context.delivery.registrationSent(context.consumer); mark("registrationSent"); return said; }
      if (ensured === "fresh") { await boundary.syncOnHeadMove(context.store, context.consumer.worktreeId, context.root); mark("syncOnHeadMove"); }
      const delta = await context.delivery.onToolBoundary(context.consumer); mark("onToolBoundary");
      const line = await context.write(() => uncovered.uncoveredEditLine(context)); mark("uncoveredEditLine");
      const room = format.MESSAGE_CAP_CHARS - (line === null ? 0 : line.length + 1);
      const text = delta === null ? null : format.formatDelta(delta, "squeal", room); mark("format");
      if (line === null) return text;
      return text === null ? `SQUEAL · ${line}` : `${text}\n${line}`;
    });
    mark("handOff");
  } else {
    const [handler, input] =
      HOOK === "ptb" ? [ptbMod.postToolBatch, { ...base, hook_event_name: "PostToolBatch", tool_names: ["Edit"] }]
      : HOOK === "stop" ? [stopMod.stop, { ...base, hook_event_name: "Stop", stop_hook_active: false }]
      : [upsMod.userPromptSubmit, { ...base, hook_event_name: "UserPromptSubmit", prompt: "probe" }];
    out = await handler(input, location, deps);
    mark("handler");
  }
  await handOffMod.writeThenCommit(handOff, [[sink, typeof out === "string" ? out : JSON.stringify(out ?? "")]]);
  mark("output+commit+close");
} catch (e) { error = String(e).slice(0, 240); mark("error"); }
const total = performance.now() - t0;
const sql = [...trace.entries()].sort((a, b) => b[1].ms - a[1].ms);
const text = out === null ? "" : typeof out === "string" ? out : JSON.stringify(out);
const row = { src: SRC.includes("0.1.546") ? "0.1.546" : "main", repo: COMMON.split("/").pop(), hook: HOOK, daemon: DAEMON, lock: LOCK, news: flipped,
  ...(env.FIRST ? { first: Number(env.FIRST) } : {}), ...(env.STUBDELAY ? { stubDelay: Number(env.STUBDELAY) } : {}),
  at: new Date().toISOString(), load1: +loadavg()[0].toFixed(1), importMs: +importMs.toFixed(0), total: +total.toFixed(1), marks, spawned, error,
  textLen: text.length, text: text.slice(0, 300), sqlMs: +sql.reduce((s, [, v]) => s + v.ms, 0).toFixed(1),
  top: TRACE ? sql.slice(0, 20).map(([k, v]) => ({ sql: k, db: v.db, n: v.n, ms: +v.ms.toFixed(1), rows: v.rows })) : undefined };
if (env.OUT) appendFileSync(env.OUT, JSON.stringify(row) + "\n");
console.log(JSON.stringify({ hook: HOOK, total: row.total, marks, error, load1: row.load1, textLen: row.textLen, news: flipped }));
