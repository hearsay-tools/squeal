import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import type { OpenCodeRun } from "../helpers/opencode.js";
import type { OpenCodeWorld } from "./opencode-fixture.js";

/*
 * Review 008-27 S1: when the stored-once `run --continue` e2e misses its
 * report, what the test can see says where, with no trace in the shipped
 * plugin (008-28). Each line is ms since the first run's idle: the session's
 * messages as OpenCode stored them, OpenCode's own log, the Squeal store's
 * PASS -> FAIL and its consumers as polled during the run (Stop's delivery
 * sets `last_delivered_at`, `dispose`'s end removes the row), and each
 * process's exit as the test saw it; then the deadlines D4 runs them under,
 * and which of them the report missed.
 */

const POLL_MS = 20;
/** D4: what the idle's deadline gives beyond `stop.waitMs`. */
const IDLE_MARGIN_MS = 500;
/** D4: `dispose`'s deadline. */
const DISPOSE_DEADLINE_MS = 3_000;
/** A stored report, as the plugin words it. */
const REPORT = "SQUEAL · ";

interface Mark {
  readonly at: number;
  readonly what: string;
}

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

/** Polls the store's consumers until OpenCode exits; each change is one entry. */
export async function watchConsumers(database: string, world: OpenCodeWorld): Promise<Seen[]> {
  const seen: Seen[] = [];
  let db: DatabaseSync | undefined;
  try {
    while (!world.done()) {
      try {
        db ??= new DatabaseSync(database, { readOnly: true });
        const rows = db
          .prepare("SELECT agent_id, last_seen_at, last_delivered_at FROM consumers")
          .all()
          .map((r) => ({
            agent: String(r.agent_id),
            seen: Number(r.last_seen_at),
            delivered: r.last_delivered_at === null ? null : Number(r.last_delivered_at),
          }));
        if (JSON.stringify(seen.at(-1)?.rows) !== JSON.stringify(rows))
          seen.push({ at: Date.now(), rows });
      } catch {
        // Busy, or not there yet: the next poll.
      }
      await sleep(POLL_MS);
    }
  } finally {
    db?.close();
  }
  return seen;
}

/** OpenCode's idle and `dispose` in its log, which can lose the last lines of a process. */
function openCodeMarks(run: OpenCodeRun): Mark[] {
  const dir = join(run.dir, "xdg/data/opencode/log");
  if (!existsSync(dir)) return [];
  const wanted = ["creating instance", "exiting loop", "disposing instance"];
  return readdirSync(dir).flatMap((file) =>
    readFileSync(join(dir, file), "utf8")
      .split("\n")
      .flatMap((line) => {
        const at = Date.parse(line.match(/^timestamp=(\S+)/)?.[1] ?? "");
        const what = wanted.find((w) => line.includes(`message="${w}"`));
        const proc = line.match(/ run=(\S+)/)?.[1] ?? "?";
        return what === undefined || Number.isNaN(at) ? [] : [{ at, what: `${what} (${proc})` }];
      }),
  );
}

interface Message {
  readonly role: string;
  readonly text: string;
  readonly created: number;
  readonly completed?: number;
}

/** The session's messages, as OpenCode stored them. */
function sessionMessages(run: OpenCodeRun, session: string): Message[] {
  const db = new DatabaseSync(join(run.dir, "xdg/data/opencode/opencode.db"), { readOnly: true });
  try {
    const parts = db.prepare(
      "SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id",
    );
    return db
      .prepare("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id")
      .all(session)
      .map((row) => {
        const info = JSON.parse(String(row.data)) as {
          role: string;
          time: { created: number; completed?: number };
        };
        const text = parts
          .all(String(row.id))
          .map((p) => JSON.parse(String(p.data)) as { type: string; text?: string })
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join(" ")
          .replace(/\s+/g, " ");
        return { role: info.role, text, ...info.time };
      });
  } finally {
    db.close();
  }
}

/** The store's pass/fail transitions. */
function transitions(database: string): Mark[] {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT t.kind, t.at, c.full_name FROM transitions t JOIN checks c ON c.id = t.check_id",
      )
      .all()
      .map((r) => ({ at: Number(r.at), what: `squeal ${r.kind} ${r.full_name}` }));
  } finally {
    db.close();
  }
}

/** `f`, or what made it unreadable. */
function read<T>(what: string, f: () => T[], failures: string[]): T[] {
  try {
    return f();
  } catch (error) {
    failures.push(`${what} unreadable: ${String(error)}`);
    return [];
  }
}

export interface TimelineInput {
  readonly first: OpenCodeRun;
  readonly session: string;
  /** The Squeal store's database. */
  readonly database: string;
  readonly stopWaitMs: number;
  readonly consumers: readonly Seen[];
  /** When the test saw each process end, by name; `run` is the first. */
  readonly exits: Readonly<Record<string, number>>;
}

/** Every mark as ms since the first run's idle, the deadlines, and which one the report missed. */
export function timeline(input: TimelineInput): string {
  const failures: string[] = [];
  const opencode = read("OpenCode's log", () => openCodeMarks(input.first), failures);
  const messages = read(
    "the session's messages",
    () => sessionMessages(input.first, input.session),
    failures,
  );
  const ran = input.exits.run ?? Number.POSITIVE_INFINITY;
  // The turn's idle: OpenCode's log when it kept the line, else its last reply's completion.
  const logged = opencode.find((m) => m.what.startsWith("exiting loop"))?.at;
  const replied = messages
    .flatMap((m) => (m.role === "assistant" && m.completed !== undefined ? [m.completed] : []))
    .filter((at) => at <= ran)
    .at(-1);
  const idle = logged ?? replied ?? 0;
  const since = (at: number) => `${at - idle >= 0 ? "+" : ""}${at - idle}`;

  const marks: Mark[] = [
    ...opencode,
    ...messages.flatMap((m) => {
      const head = `${m.role} message ${JSON.stringify(m.text.slice(0, 60))}`;
      return [
        { at: m.created, what: `${head} created` },
        ...(m.completed === undefined ? [] : [{ at: m.completed, what: `${head} completed` }]),
      ];
    }),
    ...read("the store's transitions", () => transitions(input.database), failures),
    ...input.consumers.map((s) => ({
      at: s.at,
      what: `consumers polled: ${
        s.rows.length === 0
          ? "none"
          : s.rows
              .map(
                (c) =>
                  `${c.agent} seen ${since(c.seen)} delivered ${c.delivered === null ? "never" : since(c.delivered)}`,
              )
              .join("; ")
      }`,
    })),
    ...Object.entries(input.exits).map(([name, at]) => ({ at, what: `${name} exited` })),
  ].sort((a, b) => a.at - b.at);

  const idleDeadline = idle + input.stopWaitMs + IDLE_MARGIN_MS;
  const disposing = opencode.find((m) => m.what.startsWith("disposing instance"))?.at;
  const delivered = input.consumers
    .flatMap((s) => s.rows.flatMap((c) => (c.delivered === null ? [] : [c.delivered])))
    .at(-1);
  const stored = messages.find(
    (m) => m.role === "user" && m.text.startsWith(REPORT) && m.created <= ran,
  );
  const reading =
    stored !== undefined
      ? `a report was stored at ${since(stored.created)}: compare it with what run --continue sent`
      : delivered === undefined
        ? `Stop recorded no delivery: it was not asked, had nothing to say, or the plugin killed it at the idle's deadline (${since(idleDeadline)}) before it answered`
        : delivered > idleDeadline
          ? `Stop delivered at ${since(delivered)}, past the idle's deadline (${since(idleDeadline)}): the plugin had already given up on it (D4's silence)`
          : `Stop delivered at ${since(delivered)}, within the idle's deadline (${since(idleDeadline)}), and nothing was stored before the run exited (${since(ran)}): the store missed dispose's deadline, or judged the turn overtaken`;
  return [
    `timeline, ms since the first run's idle (${logged === undefined ? "its last reply's completion; OpenCode's log lost the line" : "OpenCode's log"}):`,
    ...marks.map((m) => `  ${since(m.at)} ${m.what}`),
    `  idle's deadline (stop.waitMs ${input.stopWaitMs} + ${IDLE_MARGIN_MS}): ${since(idleDeadline)}`,
    `  dispose's deadline: ${disposing === undefined ? "not in OpenCode's log" : since(disposing + DISPOSE_DEADLINE_MS)}`,
    ...failures.map((f) => `  ${f}`),
    `reading: ${reading}`,
  ].join("\n");
}
