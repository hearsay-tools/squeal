// Throwaway probe, row 005-110. A stand-in for the write side of a serving daemon (spec 021 D15),
// on a store COPY in this task's scratch directory: a Unix socket in the scratch directory, the real
// `WriteDesk` from SRC (lease, write, release, write-status), and a "main thread" that writes each
// sent batch into the copy with the real `writeBatch` after DELAY ms, one batch at a time, as the
// daemon's main thread does between its own work. Every other request gets an error answer, as a
// daemon that does not know it would. It runs no tests and starts nothing.
// Env: SRC, COMMON (copy common dir), WORKTREE (id), SOCKET (path in scratch), DELAY (ms, default 0),
//      LOG (JSON lines: one per request, with the time each batch waited and took).
import { appendFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const env = process.env;
const SRC = env.SRC!, COMMON = env.COMMON!, WORKTREE = env.WORKTREE!, SOCKET = env.SOCKET!;
const DELAY = Number(env.DELAY ?? 0);
if (!COMMON.includes("/t/cd01ba62/") || !SOCKET.includes("/t/cd01ba62/")) throw new Error("scratch only");
const imp = (p: string) => import(pathToFileURL(`${SRC}/src/${p}`).href);
const { WriteDesk } = await imp("core/daemon/write-desk.ts");
const { parseWriteRequest } = await imp("core/daemon/write-protocol.ts");
const { writeBatch, decodeBatch } = await imp("core/daemon/write-batch.ts");
const { openStore } = await imp("core/store/open.ts");
const store = openStore(COMMON, { create: false, busyTimeoutMs: 30_000 });
if ("reason" in store) throw new Error(`open: ${store.reason}`);
const log = (o: object) => env.LOG && appendFileSync(env.LOG, JSON.stringify({ t: Date.now(), ...o }) + "\n");

// The main thread: one batch at a time, each after DELAY ms of other work.
let queue: Promise<void> = Promise.resolve();
const requestWrite = (batch: unknown) => {
  const asked = performance.now();
  const done = queue.then(async () => {
    if (DELAY > 0) await sleep(DELAY);
    const start = performance.now();
    writeBatch(store, decodeBatch(batch));
    log({ kind: "batch", statements: (batch as any).statements?.length ?? null, waitedMs: +(start - asked).toFixed(1), writeMs: +(performance.now() - start).toFixed(1) });
  });
  queue = done.catch(() => {});
  return done;
};
const desk = new WriteDesk({ worktreeId: WORKTREE, storeSchema: store.schemaVersion, requestWrite });

rmSync(SOCKET, { force: true });
const server = createServer((socket) => {
  let buffer = "";
  const opened = performance.now(); let chunks = 0;
  socket.setEncoding("utf8");
  socket.on("close", () => { if (buffer.length > 0 && buffer.indexOf("\n") < 0) log({ kind: "closed-before-line", bytes: buffer.length, chunks, openMs: +(performance.now() - opened).toFixed(1) }); });
  socket.on("data", (chunk: string) => {
    buffer += chunk; chunks++;
    const end = buffer.indexOf("\n");
    if (end < 0) return;
    let answer: object;
    const received = performance.now();
    try {
      const request = JSON.parse(buffer.slice(0, end));
      if (request.type === "write") log({ kind: "line", bytes: end, chunks, receiveMs: +(received - opened).toFixed(1), parseMs: +(performance.now() - received).toFixed(1) });
      const parsed = parseWriteRequest(request);
      if (parsed === undefined || typeof parsed === "string" || !["lease", "release", "write", "write-status"].includes((parsed as any).type)) {
        answer = { schemaVersion: 1, ok: false, error: `stub: ${request.type} not served` };
      } else answer = desk.answer(parsed, "serving");
      log({ kind: "request", type: request.type, ok: (answer as any).ok, token: (answer as any).token === undefined ? undefined : (answer as any).token !== null, written: (answer as any).written });
    } catch (error) {
      answer = { schemaVersion: 1, ok: false, error: String(error) };
    }
    socket.end(JSON.stringify(answer) + "\n");
  });
});
server.listen(SOCKET, () => console.log("listening"));
process.on("SIGTERM", () => { server.close(); store.close(); rmSync(SOCKET, { force: true }); process.exit(0); });
