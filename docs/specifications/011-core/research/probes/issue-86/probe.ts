// Throwaway (issue 86): askRetry against a synthetic store whose write lock another process holds.
// Never the live store: the store is created under a fresh mkdtemp directory and deleted at the end.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { askRetry, readRetries } from "../../../../../../src/core/retry/index.js";
import { CLI_SOCKET_TIMEOUT_MS } from "../../../../../../src/cli/daemon-access.js";
import { openStore, storePaths } from "../../../../../../src/core/store/index.js";

const [load1] = loadavg();
console.log(`load1=${load1.toFixed(2)} cpus=${cpus().length} node=${process.version} busyTimeoutMs=${CLI_SOCKET_TIMEOUT_MS}`);
if (load1 > cpus().length) { console.log("SKIP: load above CPU count"); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), "i86-"));
const commonDir = dir as never;
const created = openStore(commonDir, { create: true });
if ("reason" in created) throw new Error(`create: ${created.reason}`);
created.close();
const db = storePaths(commonDir).database;
const ask = (session: string) => ({
  testFile: { project: "p", path: "e2e/session-footer.e2e.ts" },
  key: "k1", session, reason: "load", at: Date.now(), worktreeId: "w1",
}) as never;

function hold(ms: number): Promise<() => Promise<void>> {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, "holder.mjs"), db, String(ms)]);
    const freed = new Promise<void>((done) => child.on("exit", () => done()));
    child.stdout.once("data", () => ok(() => freed));
  });
}

function attempt(label: string, session: string): void {
  const store = openStore(commonDir, { create: false, busyTimeoutMs: CLI_SOCKET_TIMEOUT_MS });
  if ("reason" in store) throw new Error(store.reason);
  const t = performance.now();
  try {
    const answer = askRetry(store, ask(session));
    console.log(`${label}: ${answer.kind} after ${Math.round(performance.now() - t)} ms`);
  } catch (e) {
    const err = e as { code?: string; errcode?: number; errstr?: string; message: string; stack?: string };
    const frames = (err.stack ?? "").split("\n").slice(1, 4).map((s) => s.trim()).join(" | ");
    console.log(`${label}: THROW after ${Math.round(performance.now() - t)} ms code=${err.code} errcode=${err.errcode} errstr=${err.errstr} message="${err.message}" frames=${frames}`);
  } finally {
    const records = readRetries(store);
    console.log(`${label}: records=${records.length}`);
    store.close();
  }
}

try {
  // A. transient hold shorter than the CLI's busy timeout
  let freed = await hold(800);
  attempt("A transient 800 ms, session s1", "s1");
  await freed();
  // B. hold longer than the busy timeout: the incident's shape
  freed = await hold(4000);
  attempt("B persistent 4000 ms, session s2", "s2");
  await freed();
  // C. the agent's next invocation once the lock is free
  attempt("C next invocation, session s2", "s2");
  // D. the same request again: duplicate guard
  attempt("D repeat, session s2", "s2");
  // E. empty session (no harness session id), twice
  attempt("E1 no session", "");
  attempt("E2 no session", "");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
