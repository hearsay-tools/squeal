// Throwaway probe, row 005-101. Runs the SessionStart hook's code in-process on a store COPY
// whose daemon sockets were rewritten to paths that do not exist (no live daemon is reached),
// and times each step, with a statement-level trace of every SQLite call.
// Run with node_modules/.bin/tsx (never pnpm exec). Env:
//   SRC     source root to import (this worktree, or an extracted candidate)
//   COMMON  the copy's common dir (holds squeal/store.sqlite)
//   ROOT    the real worktree whose id the rows carry (read only: realpath, HEAD)
//   MODE    mirror (main's startSession, step by step) | session (the source's own startSession)
//   ENSURE  spawn (stub spawns /bin/sleep detached, as a daemon spawn; no heartbeat comes)
//           | alive (stub answers alive) | none (no ensure: question 5)
//   LOCK    0, or ms a second process holds the copy's write lock from the hook's start
//   RUNS    runs; OUT: JSON lines file
import { spawn } from "node:child_process";
import { appendFileSync, openSync } from "node:fs";
import { loadavg } from "node:os";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const env = process.env;
const SRC = env.SRC!, COMMON = env.COMMON!, ROOT = env.ROOT!;
const MODE = env.MODE ?? "mirror", ENSURE = env.ENSURE ?? "spawn";
const LOCK = Number(env.LOCK ?? 0), RUNS = Number(env.RUNS ?? 5);
if (!COMMON.includes("/t/38faef1c/")) throw new Error("COMMON must be a scratch copy");

// SQL trace.
type Stat = { n: number; ms: number; rows: number; db: string; full: string };
const dbOf = new WeakMap<object, string>();
let trace = new Map<string, Stat>();
const norm = (sql: string) => sql.replace(/\s+/g, " ").trim().slice(0, 110);
const add = (sql: string, ms: number, rows: number, db = "") => {
  const k = norm(sql); const s = trace.get(k) ?? { n: 0, ms: 0, rows: 0, db, full: sql };
  s.n++; s.ms += ms; s.rows += rows; trace.set(k, s);
};
const TRACE = env.NOTRACE !== "1"; // NOTRACE=1: no wrapper, for totals without the trace's own cost
for (const m of (TRACE ? ["all", "get", "run", "iterate"] : []) as const) {
  const orig = (StatementSync.prototype as any)[m];
  (StatementSync.prototype as any)[m] = function (this: StatementSync, ...a: unknown[]) {
    const t = performance.now(); const r = orig.apply(this, a);
    const rows = m === "all" ? (r as unknown[]).length : m === "get" ? (r ? 1 : 0) : m === "run" ? Number((r as any).changes ?? 0) : 0;
    add((this as any).sourceSQL ?? "?", performance.now() - t, rows, dbOf.get(this) ?? ""); return r;
  };
}
const origExec = DatabaseSync.prototype.exec;
if (TRACE) DatabaseSync.prototype.exec = function (this: DatabaseSync, sql: string) {
  const t = performance.now(); const r = origExec.call(this, sql); add("exec: " + sql, performance.now() - t, 0); return r;
};
const origPrepare = DatabaseSync.prototype.prepare;
if (TRACE) DatabaseSync.prototype.prepare = function (this: DatabaseSync, sql: string, ...rest: any[]) {
  const t = performance.now(); const r = (origPrepare as any).call(this, sql, ...rest); add("prepare", performance.now() - t, 0);
  try { dbOf.set(r, String((this as any).location?.() ?? "").split("/").pop() ?? ""); } catch { /* closed */ }
  return r;
};

const imp = (p: string) => import(pathToFileURL(`${SRC}/src/${p}`).href);
const tImport = performance.now();
const session = await imp("harness/shared/session.ts");
const hook = await imp("harness/shared/hook.ts");
const ensureMod = await imp("harness/shared/ensure.ts");
const sweep = await imp("harness/shared/sweep.ts");
const format = await imp("core/delivery/format.ts");
const primerMod = await imp("harness/shared/primer.ts");
const coverage = await imp("harness/shared/coverage.ts");
const handOffMod = await imp("harness/shared/hand-off.ts");
const importMs = performance.now() - tImport;

const devnull = openSync("/dev/null", "w");
const sink = { write: (_t: string, cb: (e?: Error | null) => void) => { cb(null); return true; } };
let spawnMs = 0;
const ensureDaemon = async () => {
  if (ENSURE === "alive") return "alive";
  const t = performance.now();
  const child = spawn("/bin/sleep", ["3"], { detached: true, stdio: ["ignore", devnull, devnull] });
  child.unref(); spawnMs = performance.now() - t; return "spawned";
};

function lockHolder(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  const child = spawn(process.execPath, [new URL("./lock-holder.mjs", import.meta.url).pathname, `${COMMON}/squeal/store.sqlite`, String(ms)], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((res) => child.stdout!.on("data", (d) => { if (String(d).includes("locked")) res(); }));
}

const location = { root: ROOT, commonDir: COMMON };
for (let run = 0; run < RUNS; run++) {
  const sessionId = randomUUID();
  const input = { session_id: sessionId, source: "resume", hook_event_name: "SessionStart", cwd: ROOT };
  const handOff = new handOffMod.HandOff();
  const deps = { env: {}, ensureDaemon, handOff, squealVersion: "0.1.531", command: "squeal" };
  await lockHolder(LOCK);
  trace = new Map(); spawnMs = 0;
  const marks: Record<string, number> = {};
  const t0 = performance.now(); let last = t0;
  const mark = (k: string) => { const t = performance.now(); marks[k] = +(t - last).toFixed(1); last = t; };
  let text: string | null = null; let error: string | null = null;
  try {
    if (MODE === "session") {
      text = await session.startSession(input, location, deps);
      mark("startSession");
    } else {
      text = await hook.withContext(input, location, deps, async (context: any) => {
        mark("open");
        let startingSince;
        if (ENSURE !== "none") { startingSince = await ensureMod.ensureToRegister(location, deps, context); mark("ensure+settle"); }
        await sweep.unregisterSession(context, sessionId, { removeLocks: false, except: context.consumer });
        mark("sweep");
        const reg = await context.delivery.register(context.consumer, { atStart: true, ...(startingSince === undefined ? {} : { startingSince }) });
        mark("register");
        const out = format.formatRegistration(reg, format.MESSAGE_CAP_CHARS, "squeal");
        mark("format");
        void primerMod; void coverage;
        return out;
      });
    }
    await handOffMod.writeThenCommit(handOff, [[sink, text ?? ""]]);
    mark("output+commit+close");
  } catch (e) { error = String(e).slice(0, 200); mark("error"); }
  const total = performance.now() - t0;
  const sql = [...trace.entries()].sort((a, b) => b[1].ms - a[1].ms);
  const sqlMs = sql.reduce((s, [, v]) => s + v.ms, 0);
  const row = { src: SRC.includes("/cand") ? "cand" : "main", trace: TRACE, mode: MODE, ensure: ENSURE, lock: LOCK, run, load1: +loadavg()[0].toFixed(1), importMs: +importMs.toFixed(0),
    total: +total.toFixed(1), marks, spawnMs: +spawnMs.toFixed(1), sqlMs: +sqlMs.toFixed(1), error,
    starting: text?.includes("A daemon is starting") ?? null, textLen: text?.length ?? 0,
    top: sql.slice(0, 16).map(([k, v]) => ({ sql: k, db: v.db, n: v.n, ms: +v.ms.toFixed(1), rows: v.rows })),
    full: env.FULL ? sql.filter(([, v]) => v.ms > 5).map(([, v]) => ({ db: v.db, sql: v.full })) : undefined };
  if (env.OUT) appendFileSync(env.OUT, JSON.stringify(row) + "\n");
  console.log(JSON.stringify({ total: row.total, marks, sqlMs: row.sqlMs, error, load1: row.load1, textLen: row.textLen }));
  // Leave as Squawk's SessionEnd does, so runs do not pile up consumers and views (not timed).
  await session.endSession({ session_id: sessionId }, [location], { env: {}, squealVersion: "0.1.531" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
}
