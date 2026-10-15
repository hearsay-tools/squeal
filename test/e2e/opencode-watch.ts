import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import type { OpenCodeWorld } from "./opencode-fixture.js";

/*
 * Review 008-27 S1: what the e2e watches while OpenCode ends its turn, for
 * `opencode-timeline.ts`. A loaded host starves this watcher too, so each
 * time it keeps is one a process wrote where it can: the store's consumer
 * rows (Stop's delivery), and each bridge process's start from
 * `/proc/<pid>/stat`, exact however late the poll that found it. Only a
 * process's end is a poll's time: the last poll that saw it alive. The
 * bridges' parent is OpenCode: whether the consumer rows outlived it says
 * whether `dispose` ended them.
 */

const POLL_MS = 20;

interface Consumer {
  readonly agent: string;
  readonly seen: number;
  readonly delivered: number | null;
}

/** The consumers one poll saw, when they changed. */
export interface Seen {
  readonly at: number;
  readonly rows: readonly Consumer[];
}

/** One bridge process of the package: its hook, its start, the last poll that saw it alive. */
export interface Bridge {
  readonly pid: number;
  readonly kind: string;
  readonly started: number;
  /** OpenCode's pid. */
  readonly parent: number;
  alive: number;
}

/** OpenCode, the bridges' parent, at the last poll that saw it running. */
export interface Host {
  readonly pid: number;
  alive: number;
  /** The consumer rows that poll saw. */
  rows: number;
}

export interface Watched {
  readonly consumers: Seen[];
  readonly bridges: Bridge[];
  host: Host | null;
  /** The longest time between two polls, in ms: a starved watcher can miss a short bridge. */
  gap: number;
}

/** The consumers' rows, or null when the store is busy or not there yet. */
function consumerRows(db: DatabaseSync): Consumer[] | null {
  try {
    return db
      .prepare("SELECT agent_id, last_seen_at, last_delivered_at FROM consumers")
      .all()
      .map((r) => ({
        agent: String(r.agent_id),
        seen: Number(r.last_seen_at),
        delivered: r.last_delivered_at === null ? null : Number(r.last_delivered_at),
      }));
  } catch {
    return null;
  }
}

/** Process `pid`'s state letter and its fields after the name, or null once it is gone. */
function stat(pid: number): { state: string; fields: string[] } | null {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Fields after the `)` start at field 3, the state.
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0] ?? "", fields };
  } catch {
    return null;
  }
}

/** The bridge of `base`'s package that process `pid` runs, if any. */
function bridgeOf(pid: number, base: string, boot: number): Bridge | null {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    const hook = args.find((a) => a.includes(base))?.match(/\/dist\/hooks\/([\w-]+)\.mjs$/);
    if (!hook?.[1]) return null;
    // Field 22, the start in clock ticks since boot.
    const fields = stat(pid)?.fields;
    const ticks = Number(fields?.[19]);
    if (!Number.isFinite(ticks)) return null;
    const started = boot + ticks * 10;
    return { pid, kind: hook[1], started, parent: Number(fields?.[1]), alive: Date.now() };
  } catch {
    return null;
  }
}

/**
 * Until OpenCode exits: the consumers of `database` as they change, and the
 * bridges of the package under `base`. Clock ticks are 10 ms (`CLK_TCK` 100).
 */
export async function watchRun(
  database: string,
  base: string,
  world: OpenCodeWorld,
): Promise<Watched> {
  const watched: Watched = { consumers: [], bridges: [], host: null, gap: 0 };
  const boot = Date.now() - Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000;
  const known = new Map<number, Bridge | null>();
  let db: DatabaseSync | undefined;
  let polled = Date.now();
  try {
    while (!world.done()) {
      watched.gap = Math.max(watched.gap, Date.now() - polled);
      polled = Date.now();
      try {
        db ??= new DatabaseSync(database, { readOnly: true });
      } catch {
        // Not there yet.
      }
      const rows = db === undefined ? null : consumerRows(db);
      const last = watched.consumers.at(-1)?.rows;
      if (rows !== null && JSON.stringify(last) !== JSON.stringify(rows))
        watched.consumers.push({ at: Date.now(), rows });
      for (const entry of readdirSync("/proc")) {
        const pid = Number(entry);
        if (!Number.isInteger(pid)) continue;
        const bridge = known.has(pid) ? known.get(pid) : bridgeOf(pid, base, boot);
        if (!known.has(pid)) {
          known.set(pid, bridge ?? null);
          if (bridge && stat(pid)?.state !== "Z") watched.bridges.push(bridge);
          if (bridge) watched.host ??= { pid: bridge.parent, alive: Date.now(), rows: -1 };
        } else if (bridge) {
          // An exited child its parent has not reaped yet is no longer running.
          const state = stat(pid)?.state;
          if (state !== undefined && state !== "Z") bridge.alive = Date.now();
        }
      }
      const { host } = watched;
      const state = host === null ? undefined : stat(host.pid)?.state;
      if (host !== null && state !== undefined && state !== "Z") {
        host.alive = Date.now();
        host.rows = rows?.length ?? host.rows;
      }
      await sleep(POLL_MS);
    }
  } finally {
    db?.close();
  }
  return watched;
}
