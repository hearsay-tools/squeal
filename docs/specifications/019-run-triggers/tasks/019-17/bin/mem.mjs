#!/usr/bin/env node
// Throwaway probe for 019-17. Not product code. Runs as agent.
//   node mem.mjs <clone path> [--heap | --gc]
// The Squeal daemon of <clone path> (a process whose command line ends with
// `daemon <clone path>`): its pid, VmRSS, RssAnon and VmHWM from /proc, in MB. With --heap,
// also its V8 heap (Runtime.getHeapUsage: used and total) through the inspector: SIGUSR1 sent
// as squeal-e2e opens it on 127.0.0.1:9229, the reading checks the inspected pid, and the
// daemon closes the inspector again (019-12's method; --gc forces two GCs first). Prints one JSON
// line; `daemon: null` when none runs.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const [clone, flag] = process.argv.slice(2);
const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
export function findDaemon(root) {
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    const args = (read(`/proc/${pid}/cmdline`) ?? "").split("\0").filter(Boolean);
    const i = args.lastIndexOf("daemon");
    if (i >= 0 && args[i + 1] === root) return Number(pid);
  }
  return null;
}
export function procMem(pid) {
  const s = read(`/proc/${pid}/status`) ?? "";
  const mb = (k) => Math.round(Number((s.match(new RegExp(`${k}:\\s+(\\d+)`)) ?? [])[1] ?? NaN) / 102.4) / 10;
  return { rssMb: mb("VmRSS"), anonMb: mb("RssAnon"), hwmMb: mb("VmHWM") };
}

async function heap(pid, gc) {
  const busy = execFileSync("ss", ["-ltnH", "sport = :9229"], { encoding: "utf8" }).trim();
  if (busy !== "") return { error: "port 9229 in use" };
  execFileSync("sudo", ["-n", "-u", "squeal-e2e", "kill", "-USR1", String(pid)]);
  let url = null;
  for (let i = 0; i < 40 && url === null; i++) {
    await sleep(100);
    url = await fetch("http://127.0.0.1:9229/json/list")
      .then((r) => r.json())
      .then((l) => l[0]?.webSocketDebuggerUrl ?? null)
      .catch(() => null);
  }
  if (url === null) return { error: "no inspector" };
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let next = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    pending.get(msg.id)?.(msg);
  };
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++next;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const who = await call("Runtime.evaluate", { expression: "process.pid", returnByValue: true });
  if (gc) for (let i = 0; i < 2; i++) await call("HeapProfiler.collectGarbage");
  const usage = await call("Runtime.getHeapUsage");
  ws.send(JSON.stringify({ id: ++next, method: "Runtime.evaluate", params: { expression: "setTimeout(() => process.getBuiltinModule('node:inspector').close(), 50), 0" } }));
  await sleep(200);
  ws.close();
  const inspected = who.result?.result?.value;
  if (inspected !== pid) return { error: `inspected pid ${inspected}` };
  const mb = (n) => Math.round(n / 104857.6) / 10;
  return { heapUsedMb: mb(usage.result.usedSize), heapTotalMb: mb(usage.result.totalSize) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pid = findDaemon(clone);
  const out = { at: new Date().toISOString(), daemon: pid };
  if (pid !== null) {
    Object.assign(out, procMem(pid));
    if (flag === "--heap" || flag === "--gc")
      Object.assign(out, await heap(pid, flag === "--gc").catch((e) => ({ error: String(e) })));
  }
  console.log(JSON.stringify(out));
}
