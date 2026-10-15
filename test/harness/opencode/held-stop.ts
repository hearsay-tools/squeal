import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { tempDir } from "../../store/helpers.js";

/*
 * The barriers of `opencode-dispose.test.ts` (review 008-27 B1): a stand-in
 * Stop held until released, and a wrapper around the built plugin that logs
 * the lifecycle and delegates to it. The held Stop runs inside the idle's
 * deadline, `stop.waitMs` 1,500 plus 500 ms (D4), which the plugin enforces
 * by killing its group with SIGKILL. An attempt whose Stop is gone before
 * its barriers is `Missed`, and retried, only when the log proves that kill
 * at or after the deadline (review 008-32 B2); any other end fails with the
 * observations.
 */

export const OLD = "SQUEAL · old turn report";
export const INPUT = "new input";
/** D4: the held Stop's deadline from idle, at the policy's `stop.waitMs` of 1,500. */
export const IDLE_DEADLINE_MS = 2_000;
const BARRIER_MS = 30_000;

export interface Barriers {
  /**
   * Lines `<mark> <ms since the epoch> [<pid>]`, in order: `stop` (with the Stop's pid),
   * `dispose`, `input`, `aborted`, `answered`, `disposed`; each instance's `idle` in between;
   * `exit` (with its code) when the held Stop ends on its own, `kill` (with the group) when
   * the plugin kills a live bridge group.
   */
  readonly log: string;
  /** Stop answers once this exists. */
  readonly release: string;
  /** The second model reply returns once this exists. */
  readonly reply: string;
  /** The wrapper plugin for the run's `plugins/`. */
  readonly plugin: string;
}

/**
 * Replaces the built Stop in `dist` with one that logs its start and any
 * end of its own, waits for `release` and answers `OLD`, the first time
 * only; and wraps the built plugin to log `dispose`, the new input, an
 * abort and its kills of live bridge groups, releasing Stop at the input
 * when `releaseAtInput`.
 */
export function barriers(dist: string, releaseAtInput: boolean): Barriers {
  const dir = tempDir("squeal-oc-dispose-");
  const log = join(dir, "log");
  const release = join(dir, "release");
  const reply = join(dir, "reply");
  const answered = join(dir, "answered");
  writeFileSync(log, "");
  writeFileSync(
    join(dist, "hooks", "stop.mjs"),
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
readFileSync(0, "utf8");
const once = !existsSync(${JSON.stringify(answered)});
writeFileSync(${JSON.stringify(answered)}, "");
if (once) {
  appendFileSync(${JSON.stringify(log)}, \`stop \${Date.now()} \${process.pid}\\n\`);
  // Every end but SIGKILL's: an exit, a crash, a catchable signal.
  process.on("exit", (code) => appendFileSync(${JSON.stringify(log)}, \`exit \${Date.now()} \${code}\\n\`));
  for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]])
    process.on(signal, () => process.exit(code));
}
const answer = (report) => process.stdout.write(JSON.stringify({ answer: { report } }));
if (!once) answer(null);
else {
  const timer = setInterval(() => {
    if (!existsSync(${JSON.stringify(release)})) return;
    clearInterval(timer);
    appendFileSync(${JSON.stringify(log)}, \`answered \${Date.now()}\\n\`);
    answer(${JSON.stringify(OLD)});
  }, 5);
}
`,
  );
  const plugin = join(dir, "squeal.js");
  writeFileSync(
    plugin,
    `import { appendFileSync, writeFileSync } from "node:fs";
import mod from ${JSON.stringify(join(dist, "plugin.mjs"))};
const mark = (line) => appendFileSync(${JSON.stringify(log)}, \`\${line} \${Date.now()}\\n\`);
// Observes, then delegates: the plugin's SIGKILL of a bridge group still alive, a settle
// before its leader's exit; the kill after an exit finds the group gone and is not logged.
const kill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (signal === "SIGKILL" && pid < 0) {
    let alive = true;
    try { kill(pid, 0); } catch { alive = false; }
    if (alive) appendFileSync(${JSON.stringify(log)}, \`kill \${Date.now()} \${-pid}\\n\`);
  }
  return kill(pid, signal);
};
export const Squeal = async (input) => {
  const hooks = await mod.server(input);
  return {
    ...hooks,
    async event(arg) {
      if (arg.event.type === "session.idle") mark("idle");
      if (arg.event.properties?.error?.name === "MessageAbortedError") mark("aborted");
      return hooks.event?.(arg);
    },
    async "chat.message"(input, output) {
      if (output.parts.some((part) => part?.text === ${JSON.stringify(INPUT)})) {
        mark("input");
        if (${releaseAtInput}) writeFileSync(${JSON.stringify(release)}, "");
      }
      return hooks["chat.message"]?.(input, output);
    },
    async dispose() {
      mark("dispose");
      await hooks.dispose?.();
      mark("disposed");
    },
  };
};
`,
  );
  return { log, release, reply, plugin };
}

export interface Mark {
  readonly name: string;
  readonly at: number;
  /** `stop`'s pid, `exit`'s code, `kill`'s group. */
  readonly n?: number;
}

export const marks = (b: Pick<Barriers, "log">): Mark[] =>
  readFileSync(b.log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", at, n] = line.split(" ");
      return { name, at: Number(at), ...(n === undefined ? {} : { n: Number(n) }) };
    });
/** The procedure's marks in order: an instance's idle, an exit or a kill is no step of it. */
export const logged = (b: Pick<Barriers, "log">) =>
  marks(b).flatMap((m) => (["idle", "exit", "kill"].includes(m.name) ? [] : [m.name]));
export const saw = (b: Pick<Barriers, "log">, line: string) => logged(b).includes(line);

/** Each mark's ms since the first idle, and the held Stop's deadline. */
export function timeline(b: Pick<Barriers, "log">): string {
  const all = marks(b);
  const idle = all.find((m) => m.name === "idle")?.at ?? all[0]?.at ?? 0;
  const rows = all.map((m) => {
    const n = m.n === undefined ? "" : ` (${m.name === "exit" ? "code" : "pid"} ${m.n})`;
    return `${m.name} +${m.at - idle}${n}`;
  });
  return `marks, ms since the first idle: ${rows.join(", ")}; the held Stop's deadline: +${IDLE_DEADLINE_MS}`;
}

/** An attempt whose held Stop was killed at its deadline before the barriers ordered the race. */
export class Missed extends Error {}

/** Why the held Stop ended, once gone; `missed` only for its kill at or after the deadline. */
export interface Gone {
  readonly missed: boolean;
  readonly why: string;
}

/**
 * Why the held Stop can no longer answer, once its process ended without
 * `answered`; `now` is when it was seen gone. The proof of a deadline miss
 * is the plugin's kill of the live Stop no earlier than idle's mark plus
 * the deadline: that mark precedes the plugin's own deadline start, and a
 * Stop's call has no other cancel. An exit of its own, a kill before then,
 * or no kill or idle in the log is not a deadline miss.
 */
export function stopGone(b: Pick<Barriers, "log">, now: number): Gone | null {
  const all = marks(b);
  const stop = all.find((m) => m.name === "stop");
  if (stop?.n === undefined) return null;
  try {
    process.kill(stop.n, 0);
    return null;
  } catch {
    // Read after the exit: a Stop that answered marked it first.
    if (saw(b, "answered")) return null;
  }
  const idle = all.find((m) => m.name === "idle")?.at;
  const seen = `seen gone ${idle === undefined ? "with no idle" : `+${now - idle} ms after idle`}`;
  const exit = all.find((m) => m.name === "exit");
  const kill = all.find((m) => m.name === "kill" && m.n === stop.n);
  if (exit !== undefined) {
    const at = idle === undefined ? "" : ` at +${exit.at - idle}`;
    return { missed: false, why: `the held Stop exited on its own${at} (code ${exit.n}), ${seen}` };
  }
  if (idle === undefined || kill === undefined)
    return {
      missed: false,
      why: `unresolved: the held Stop ended without answering, ${seen}, and the log has ${
        kill === undefined ? "no kill of it by the plugin" : "no idle to time its kill"
      }`,
    };
  const killed = `the plugin killed the held Stop at +${kill.at - idle}`;
  return kill.at - idle >= IDLE_DEADLINE_MS
    ? { missed: true, why: `${killed}, at or after its idle deadline (+${IDLE_DEADLINE_MS})` }
    : { missed: false, why: `${killed}, before its idle deadline (+${IDLE_DEADLINE_MS})` };
}

/** Until `done`; a held Stop gone first is `Missed` at its deadline, otherwise an error; both print the marks. */
export async function reached(b: Barriers, what: string, done: () => boolean): Promise<void> {
  const limit = Date.now() + BARRIER_MS;
  while (!done()) {
    const gone = stopGone(b, Date.now());
    if (gone !== null) {
      const message = `before ${what}, ${gone.why}\n${timeline(b)}`;
      throw gone.missed ? new Missed(message) : new Error(message);
    }
    if (Date.now() > limit) throw new Error(`${what}: not within ${BARRIER_MS} ms\n${timeline(b)}`);
    await sleep(10);
  }
}
