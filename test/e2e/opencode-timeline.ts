import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpenCodeRun } from "../helpers/opencode.js";
import type { Bridge, Watched } from "./opencode-watch.js";

/*
 * Review 008-27 S1: when the stored-once `run --continue` e2e misses its
 * report, what the test can see says where, with no trace in the shipped
 * plugin (008-28). Each line is ms since the first run's idle: the session's
 * messages as OpenCode stored them, OpenCode's own log, the Squeal store's
 * PASS -> FAIL, what `opencode-watch.ts` saw during the run (Stop's delivery
 * in the consumer rows, each bridge process's start and last sign of life),
 * and each process's exit as the test saw it; then the deadlines D4 runs
 * them under, and which of them the report missed.
 */

/** D4: what the idle's deadline gives beyond `stop.waitMs`. */
const IDLE_MARGIN_MS = 500;
/** D4: `dispose`'s deadline, of which the store leaves `DISPOSE_END_MS` for ending consumers. */
const DISPOSE_DEADLINE_MS = 3_000;
const DISPOSE_END_MS = 500;
/** A consumer last seen this close to the store's deadline was held there by the store. */
const HELD_MS = 250;
/** A stored report, as the plugin words it. */
const REPORT = "SQUEAL · ";

interface Mark {
  readonly at: number;
  readonly what: string;
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
  readonly watched: Watched;
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
    ...input.watched.bridges.flatMap((b) => [
      { at: b.started, what: `bridge ${b.kind} (pid ${b.pid}) started` },
      { at: b.alive, what: `bridge ${b.kind} (pid ${b.pid}) last seen alive` },
    ]),
    ...input.watched.consumers.map((s) => ({
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
  // `run` disposes about 10 ms after idle (008-25) when OpenCode's log lost the line.
  const storeDeadline = (disposing ?? idle) + DISPOSE_DEADLINE_MS - DISPOSE_END_MS;
  const reading = readingOf(input, { idle, idleDeadline, storeDeadline, messages, since });
  return [
    `timeline, ms since the first run's idle (${logged === undefined ? "its last reply's completion; OpenCode's log lost the line" : "OpenCode's log"}):`,
    ...marks.map((m) => `  ${since(m.at)} ${m.what}`),
    `  idle's deadline (stop.waitMs ${input.stopWaitMs} + ${IDLE_MARGIN_MS}): ${since(idleDeadline)}`,
    `  dispose's deadline: ${disposing === undefined ? "not in OpenCode's log" : since(disposing + DISPOSE_DEADLINE_MS)}, the store's ${since(storeDeadline)}`,
    ...failures.map((f) => `  ${f}`),
    `reading: ${reading}`,
  ].join("\n");
}

interface Reading {
  readonly idle: number;
  readonly idleDeadline: number;
  readonly storeDeadline: number;
  readonly messages: readonly Message[];
  readonly since: (at: number) => string;
}

/**
 * Which deadline the report missed. Stop's delivery, in the store, against
 * the idle's deadline; then its bridge: alive past that deadline, the plugin
 * killed it and dropped its answer. Then `dispose`'s `end` bridge, which
 * starts once the idle in flight is done: at the store's deadline, the
 * overtaken check's read or the store ran out of time; well before it, the
 * plugin let the report go of its own accord.
 */
function readingOf(input: TimelineInput, r: Reading): string {
  const { since } = r;
  const { consumers, bridges } = input.watched;
  const ran = input.exits.run ?? Number.POSITIVE_INFINITY;
  const after = r.messages.filter(
    (m) => m.role === "user" && m.created > r.idle && m.created <= ran,
  );
  const stored = after.find((m) => m.text.startsWith(REPORT));
  if (stored !== undefined)
    return `a report was stored at ${since(stored.created)}: compare it with what run --continue sent`;
  const delivered = consumers
    .flatMap((s) => s.rows.flatMap((c) => (c.delivered === null ? [] : [c.delivered])))
    .at(-1);
  const near = (b: Bridge) => b.started >= r.idle - HELD_MS && b.started <= ran;
  const stop = bridges.find((b) => b.kind === "stop" && near(b));
  const end = bridges.find((b) => b.kind === "end" && near(b));
  const begun = after[0];
  const store =
    begun === undefined
      ? "OpenCode never created its message"
      : `OpenCode created its message at ${since(begun.created)} and never finished it`;
  const facts = [
    delivered === undefined ? "Stop recorded no delivery" : `Stop delivered at ${since(delivered)}`,
    stop === undefined
      ? "its bridge was not seen"
      : `its bridge ran from ${since(stop.started)}, last seen alive ${since(stop.alive)}`,
    end === undefined
      ? "no end bridge was seen"
      : `dispose's end bridge started ${since(end.started)}`,
    store,
  ].join("; ");
  const cause =
    stop !== undefined && stop.alive >= r.idleDeadline
      ? `Stop's bridge outlived the idle's deadline (${since(r.idleDeadline)}): the plugin killed it and dropped its answer, D4's silence at a missed deadline`
      : delivered === undefined
        ? "Stop had nothing to deliver, or never reached the daemon"
        : end === undefined
          ? "unresolved: the watcher missed the end bridge"
          : end.started >= r.storeDeadline - HELD_MS
            ? `the idle held dispose until the store's deadline (${since(r.storeDeadline)}): the overtaken check's read or the store did not finish in time, D4's silence at a missed deadline`
            : `the idle let dispose go before the store's deadline (${since(r.storeDeadline)}) with nothing stored: the plugin dropped the report, its answer late or the turn judged overtaken`;
  return `${facts}. ${cause}`;
}
