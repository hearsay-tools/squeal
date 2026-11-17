// Throwaway probe for row 005-99: shared daemon log parser (see README.md).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LINE = /^(\S+) \[(\d+)\] squeal daemon: (.*)$/;

/** Every daemon process in the logs: per pid, its first line, serving, stop and root. */
export function daemons(logsDir) {
  const byRoot = new Map();
  const loads = [];
  for (const name of readdirSync(logsDir)) {
    if (!name.endsWith(".log") && !name.endsWith(".log.1")) continue;
    const pids = new Map();
    for (const line of readFileSync(join(logsDir, name), "utf8").split("\n")) {
      const m = LINE.exec(line);
      if (m === null) continue;
      const at = Date.parse(m[1]);
      const pid = `${name}:${m[2]}`;
      const text = m[3];
      let p = pids.get(pid);
      if (p === undefined) {
        p = { pid, log: name, first: at, last: at, serving: null, stop: null, reason: null, root: null, gaveUp: false, other: false };
        pids.set(pid, p);
      }
      p.last = at;
      const serving = /^serving (\S+) on /.exec(text);
      if (serving !== null && p.serving === null) {
        p.serving = at;
        p.root = serving[1];
      }
      const other = /^another daemon serves (\S+)/.exec(text);
      if (other !== null) {
        p.other = true;
        p.root ??= other[1];
      }
      if (text.startsWith("a daemon gave up")) p.gaveUp = true;
      if (text.startsWith("daemon stopped") && p.stop === null) {
        p.stop = at;
        p.reason = text.replace(/\d+/g, "N").slice(16, 80);
      }
      const busy = /(\d+(?:\.\d+)?) busy CPUs/.exec(text) ?? /\((\d+) of \d+ cores in use/.exec(text);
      if (busy !== null) loads.push([at, Number(busy[1])]);
    }
    // A log holds one worktree: give pids without a root the log's root.
    const root = [...pids.values()].find((p) => p.root !== null)?.root ?? null;
    for (const p of pids.values()) {
      p.root ??= root;
      if (p.root === null) continue;
      if (!byRoot.has(p.root)) byRoot.set(p.root, []);
      byRoot.get(p.root).push(p);
    }
  }
  for (const list of byRoot.values()) list.sort((a, b) => a.first - b.first);
  loads.sort((a, b) => a[0] - b[0]);
  const byLog = new Map();
  for (const list of byRoot.values()) for (const p of list) {
    const id = p.log.replace(/^daemon-/, '').replace(/\.log(\.1)?$/, '');
    if (!byLog.has(id)) byLog.set(id, []);
    byLog.get(id).push(p);
  }
  return { byRoot, byLog, loads };
}

/** Busy CPUs logged nearest `at`, within 120 s; null when none. */
export function loadAt(loads, at) {
  let best = null;
  for (const [t, v] of loads) {
    if (Math.abs(t - at) > 120_000) continue;
    if (best === null || Math.abs(t - at) < Math.abs(best[0] - at)) best = [t, v];
  }
  return best === null ? null : best[1];
}

