import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { OpenCodeRun } from "../helpers/opencode.js";
import { tempDir } from "../store/helpers.js";
import { type TimelineInput, timeline } from "./opencode-timeline.js";
import type { Bridge, Seen, Watched } from "./opencode-watch.js";

/*
 * Review 008-32 B2: the stored-once e2e retries an attempt only when its
 * timeline proves the report missed one of D4's deadlines. Small fixture
 * databases, no OpenCode: the first reply completes at idle and no report is
 * stored. Times are ms after that idle; at `stop.waitMs` 1,500 the idle's
 * deadline is +2000, and with OpenCode's log disposing at +0 the store's is
 * +2500. A log that lost its dispose line bounds no deadline of dispose's
 * (round 2).
 */

const IDLE = Date.parse("2026-10-15T07:00:00.000Z");
const SESSION = "ses_1";
const at = (ms: number) => IDLE + ms;

/**
 * A run directory whose OpenCode database holds the session's `edit` and its
 * reply, completed at `replied`, and whose log disposed at `disposed`.
 */
function opencodeRun(replied: number | null, disposed: number | null): OpenCodeRun {
  const dir = tempDir("squeal-oc-timeline-");
  const data = join(dir, "xdg/data/opencode");
  mkdirSync(join(data, "log"), { recursive: true });
  if (disposed !== null) {
    const stamp = new Date(disposed).toISOString();
    const line = `timestamp=${stamp} service=default message="disposing instance" run=r1\n`;
    writeFileSync(join(data, "log/run.log"), line);
  }
  const db = new DatabaseSync(join(data, "opencode.db"));
  db.exec("CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)");
  db.exec("CREATE TABLE part (id TEXT, message_id TEXT, time_created INTEGER, data TEXT)");
  const message = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  const part = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)");
  const add = (id: string, role: string, text: string, time: object, created: number) => {
    message.run(id, SESSION, created, JSON.stringify({ role, time }));
    part.run(`${id}p`, id, created, JSON.stringify({ type: "text", text }));
  };
  add("m1", "user", "edit", { created: at(-2_000) }, at(-2_000));
  if (replied !== null)
    add("m2", "assistant", "done", { created: at(-1_500), completed: replied }, at(-1_500));
  db.close();
  return { dir } as OpenCodeRun;
}

/** The Squeal store's database, with the one PASS -> FAIL. */
function store(): string {
  const path = join(tempDir("squeal-oc-timeline-store-"), "store.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE checks (id INTEGER, full_name TEXT)");
  db.exec("CREATE TABLE transitions (check_id INTEGER, kind TEXT, at INTEGER)");
  db.exec(
    `INSERT INTO checks VALUES (1, 'k1'); INSERT INTO transitions VALUES (1, 'fail', ${at(-1_000)})`,
  );
  db.close();
  return path;
}

const bridge = (kind: string, started: number, alive: number): Bridge => ({
  pid: 100,
  kind,
  started: at(started),
  alive: at(alive),
  parent: 1,
});
/** Stop delivered at +100, its bridge done by +200. */
const delivered: Seen = {
  at: at(100),
  after: at(80),
  rows: [{ agent: "root", seen: at(0), delivered: at(100) }],
};
const removed = (after: number, seen: number): Seen => ({
  at: at(seen),
  after: at(after),
  rows: [],
});

/** The watched run, the first run exited at `exited`, its reply completed at `replied`, disposed at `disposed`. */
function input(
  watched: Partial<Watched>,
  {
    exited = 2_400,
    replied = at(0),
    disposed = at(0),
  }: { exited?: number; replied?: number | null; disposed?: number | null } = {},
): TimelineInput {
  return {
    first: opencodeRun(replied, disposed),
    session: SESSION,
    database: store(),
    stopWaitMs: 1_500,
    watched: {
      consumers: [delivered],
      bridges: [bridge("stop", 10, 200)],
      host: { pid: 1, alive: at(2_390), rows: 0 },
      gap: 20,
      ...watched,
    },
    exits: { run: at(exited) },
  };
}

describe("the e2e timeline's deadline proof (review 008-32 B2)", () => {
  it("is no miss when the end bridge started before the store's deadline", () => {
    // Review 008-32's probe: the whole run ended before the deadline; and 1 ms before it.
    for (const [started, exited] of [
      [2_300, 2_400],
      [2_499, 2_600],
    ] as const) {
      const bridges = [bridge("stop", 10, 200), bridge("end", started, started + 50)];
      const t = timeline(input({ bridges }, { exited }));
      expect(t.missedDeadline, t.text).toBe(false);
      expect(t.text).toContain(`dispose's end bridge started +${started}`);
      expect(t.text).toContain("before the store's deadline (+2500) with nothing stored");
    }
  });

  it("is no miss when dispose removed the consumer before the store's deadline", () => {
    const t = timeline(input({ consumers: [delivered, removed(2_300, 2_350)] }));
    expect(t.missedDeadline, t.text).toBe(false);
    expect(t.text).toContain(
      "between +2300 and +2350, while OpenCode ran, before the store's deadline (+2500)",
    );
  });

  it("is a miss when the end bridge started at the store's deadline", () => {
    const t = timeline(
      input(
        {
          bridges: [bridge("stop", 10, 200), bridge("end", 2_500, 2_550)],
          host: { pid: 1, alive: at(2_590), rows: 0 },
        },
        { exited: 2_600 },
      ),
    );
    expect(t.missedDeadline, t.text).toBe(true);
    expect(t.text).toContain("the idle held dispose until the store's deadline (+2500)");
  });

  it("is a miss when dispose removed the consumer only after the store's deadline", () => {
    const t = timeline(
      input(
        {
          consumers: [delivered, removed(2_500, 2_520)],
          host: { pid: 1, alive: at(2_590), rows: 0 },
        },
        { exited: 2_600 },
      ),
    );
    expect(t.missedDeadline, t.text).toBe(true);
  });

  it("is a miss when Stop's bridge outlived the idle's deadline", () => {
    const t = timeline(input({ bridges: [bridge("stop", 10, 2_000)] }));
    expect(t.missedDeadline, t.text).toBe(true);
    expect(t.text).toContain("Stop's bridge outlived the idle's deadline (+2000)");
  });

  it("is unresolved, no miss, when the watcher saw no end of the consumer", () => {
    const t = timeline(input({}));
    expect(t.missedDeadline, t.text).toBe(false);
    expect(t.text).toContain("unresolved: the watcher missed the end bridge");
  });

  it("is unresolved, no miss, with no idle in OpenCode's log or messages", () => {
    const t = timeline(
      input(
        { bridges: [bridge("stop", 10, 200), bridge("end", 2_600, 2_650)] },
        { exited: 2_700, replied: null },
      ),
    );
    expect(t.missedDeadline, t.text).toBe(false);
    expect(t.text).toContain("unresolved");
  });

  it("is no miss with the dispose line, and unresolved without it, for the same run (round 2)", () => {
    // Review 008-32 round 2's pair: one observation set, the dispose line at +100 or lost.
    const watched = {
      bridges: [bridge("stop", 10, 200), bridge("end", 2_500, 2_550)],
      host: { pid: 1, alive: at(2_590), rows: 0 },
    };
    const seen = timeline(input(watched, { exited: 2_600, disposed: at(100) }));
    expect(seen.missedDeadline, seen.text).toBe(false);
    expect(seen.text).toContain("before the store's deadline (+2600) with nothing stored");
    const lost = timeline(input(watched, { exited: 2_600, disposed: null }));
    expect(lost.missedDeadline, lost.text).toBe(false);
    expect(lost.text).toContain("unresolved: OpenCode's log lost its dispose line");
  });

  it("is unresolved, no miss, without the dispose line for the consumer-removal and live-host paths", () => {
    const late = timeline(
      input(
        {
          consumers: [delivered, removed(2_500, 2_520)],
          host: { pid: 1, alive: at(2_590), rows: 0 },
        },
        { exited: 2_600, disposed: null },
      ),
    );
    expect(late.missedDeadline, late.text).toBe(false);
    expect(late.text).toContain("unresolved: OpenCode's log lost its dispose line");
    const live = timeline(
      input({ host: { pid: 1, alive: at(3_500), rows: 1 } }, { exited: 3_600, disposed: null }),
    );
    expect(live.missedDeadline, live.text).toBe(false);
    expect(live.text).toContain("unresolved: OpenCode's log lost its dispose line");
  });

  it("is a miss when Stop's bridge outlived the idle's deadline, with or without the dispose line", () => {
    const t = timeline(input({ bridges: [bridge("stop", 10, 2_000)] }, { disposed: null }));
    expect(t.missedDeadline, t.text).toBe(true);
    expect(t.text).toContain("Stop's bridge outlived the idle's deadline (+2000)");
  });

  it("is a miss when OpenCode outlived dispose's deadline still holding the consumer", () => {
    const t = timeline(input({ host: { pid: 1, alive: at(3_100), rows: 1 } }, { exited: 3_200 }));
    expect(t.missedDeadline, t.text).toBe(true);
    expect(t.text).toContain("past dispose's deadline (+3000)");
  });
});
