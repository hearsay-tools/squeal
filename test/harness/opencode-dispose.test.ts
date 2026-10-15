import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { PLANNED_MODEL } from "../fixtures/opencode/scripted-provider.js";
import { type OpenCodeLive, opencodeUnavailable } from "../helpers/opencode.js";
import { tempDir } from "../store/helpers.js";
import type { SquealRepo } from "./helpers.js";
import { buildOpencodeBundles } from "./opencode/helpers.js";
import { type SquealRun, squealOpenCode } from "./opencode/real.js";

/*
 * Review 008-27 B1 with the real OpenCode 1.18.35: the first reply goes idle
 * and its Stop is held; `dispose` begins, and lets that idle finish to store
 * its news (008-25); then new input arrives, which OpenCode routes to the
 * plugin instance it re-creates, and in the second case that turn is
 * aborted. Only then does the held Stop answer. Its report is the old turn's
 * and must not be stored. Barriers order each step, no sleep decides the
 * race: Stop began, `dispose` entered, the input reached `chat.message`, the
 * abort reached the listeners, then Stop answers. The Stop is a stand-in
 * that answers once; every other bridge is the built one, and a wrapper
 * around the built plugin records the lifecycle and delegates to it.
 *
 * The held Stop runs inside the idle's deadline, `stop.waitMs` 1,500 plus
 * 500 ms (D4), which the plugin enforces by killing it. On a loaded host the
 * re-created instance can take longer than that to see the new input or the
 * abort (review 008-27 round 2), so the Stop is gone before its barrier: that
 * attempt never reached the order under test and says so (`Missed`), with
 * each mark's time since idle, and the test tries again, `ATTEMPTS` in all.
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

const OLD = "SQUEAL · old turn report";
const INPUT = "new input";
/** D4: the held Stop's deadline from idle, at the policy's `stop.waitMs` of 1,500. */
const IDLE_DEADLINE_MS = 2_000;
const BARRIER_MS = 30_000;
const ATTEMPTS = 3;

let built = { dir: "", cleanup: () => {} };
const runs: SquealRun[] = [];
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 120_000);
afterAll(() => built.cleanup());
afterEach(() => {
  for (const { run } of runs.splice(0)) run.cleanup();
});

interface Barriers {
  /**
   * Lines `<mark> <ms since the epoch>`, in order: `stop` (with the Stop's pid), `dispose`,
   * `input`, `aborted`, `answered`, `disposed`; each instance's `idle` in between.
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
 * Replaces the built Stop with one that logs its start, waits for `release`
 * and answers `OLD`, the first time only; and wraps the built plugin to log
 * `dispose`, the new input and an abort, releasing Stop at the input when
 * `releaseAtInput`.
 */
function barriers(releaseAtInput: boolean): Barriers {
  const dir = tempDir("squeal-oc-dispose-");
  const log = join(dir, "log");
  const release = join(dir, "release");
  const reply = join(dir, "reply");
  const answered = join(dir, "answered");
  writeFileSync(log, "");
  writeFileSync(
    join(built.dir, "hooks", "stop.mjs"),
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
readFileSync(0, "utf8");
const once = !existsSync(${JSON.stringify(answered)});
writeFileSync(${JSON.stringify(answered)}, "");
if (once) appendFileSync(${JSON.stringify(log)}, \`stop \${Date.now()} \${process.pid}\\n\`);
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
import mod from ${JSON.stringify(join(built.dir, "plugin.mjs"))};
const mark = (line) => appendFileSync(${JSON.stringify(log)}, \`\${line} \${Date.now()}\\n\`);
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

interface Mark {
  readonly name: string;
  readonly at: number;
  readonly pid?: number;
}

const marks = (b: Barriers): Mark[] =>
  readFileSync(b.log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", at, pid] = line.split(" ");
      return { name, at: Number(at), ...(pid === undefined ? {} : { pid: Number(pid) }) };
    });
/** The marks in order, idles left out: an instance's idle is no step of the procedure. */
const logged = (b: Barriers) => marks(b).flatMap((m) => (m.name === "idle" ? [] : [m.name]));
const saw = (b: Barriers, line: string) => logged(b).includes(line);

/** Each mark's ms since the first idle, and the held Stop's deadline. */
function timeline(b: Barriers): string {
  const all = marks(b);
  const idle = all.find((m) => m.name === "idle")?.at ?? all[0]?.at ?? 0;
  const rows = all.map(
    (m) => `${m.name} +${m.at - idle}${m.pid === undefined ? "" : ` (pid ${m.pid})`}`,
  );
  return `marks, ms since the first idle: ${rows.join(", ")}; the held Stop's deadline: +${IDLE_DEADLINE_MS}`;
}

/** An attempt whose held Stop ended before its barriers ordered the race: nothing was tested. */
class Missed extends Error {}

/** Why the held Stop can no longer answer, once its process ended without `answered`. */
function stopGone(b: Barriers, now: number): string | null {
  const stop = marks(b).find((m) => m.name === "stop");
  if (stop?.pid === undefined) return null;
  try {
    process.kill(stop.pid, 0);
    return null;
  } catch {
    // Read after the exit: a Stop that answered marked it first.
    if (saw(b, "answered")) return null;
    const idle = marks(b).find((m) => m.name === "idle")?.at ?? stop.at;
    return `the held Stop ended without answering, seen +${now - idle} ms after idle: the plugin kills it at its idle deadline (+${IDLE_DEADLINE_MS})`;
  }
}

/** Until `done`; a held Stop that ended first is `Missed`, and every miss prints the marks. */
async function reached(b: Barriers, what: string, done: () => boolean): Promise<void> {
  const limit = Date.now() + BARRIER_MS;
  while (!done()) {
    const gone = stopGone(b, Date.now());
    if (gone !== null) throw new Missed(`before ${what}, ${gone}\n${timeline(b)}`);
    if (Date.now() > limit) throw new Error(`${what}: not within ${BARRIER_MS} ms\n${timeline(b)}`);
    await sleep(10);
  }
}

/** `attempt` until one reaches its barriers, `ATTEMPTS` in all; each missed one is annotated. */
async function ordered<T>(ctx: TestContext, attempt: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof Missed) || n === ATTEMPTS) throw error;
      await ctx.annotate(`attempt ${n} of ${ATTEMPTS} missed its barriers: ${error.message}`);
    }
  }
}

/** OpenCode's request on the fixture project's instance. */
const call = (live: OpenCodeLive, r: SquealRepo, path: string, method = "GET") =>
  fetch(`${live.url}${path}`, { method, headers: { "x-opencode-directory": r.root } });

/** The session's user message texts, as OpenCode stored them. */
async function userTexts(live: OpenCodeLive, r: SquealRepo): Promise<string[]> {
  const response = await call(live, r, `/session/${live.sessionID}/message`);
  const messages = (await response.json()) as {
    info: { role: string };
    parts: { type: string; text?: string }[];
  }[];
  return messages
    .filter((m) => m.info.role === "user")
    .map((m) => m.parts.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(""));
}

/**
 * A `serve` run whose first reply's Stop is held; once it began, `dispose`
 * starts and, once it entered, `during` runs; then what OpenCode stored.
 */
async function overtaken(
  b: Barriers,
  during: (live: OpenCodeLive, r: SquealRepo) => Promise<void>,
): Promise<string[]> {
  let texts: string[] = [];
  const result = await squealOpenCode({
    dist: built.dir,
    plugin: b.plugin,
    timeoutMs: 120_000,
    mode: "serve",
    prompt: "think",
    plan: [{ text: "done" }, { text: "second", release: b.reply }, { text: "late" }],
    prepare: (r) => r.policy({ stop: { waitMs: 1_500 } }),
    afterReply: async (live, r) => {
      await reached(b, "Stop began", () => saw(b, "stop"));
      const disposing = call(live, r, "/instance/dispose", "POST");
      await reached(b, "dispose entered", () => saw(b, "dispose"));
      const second = live.message(INPUT).catch(() => {});
      await during(live, r);
      expect((await disposing).ok).toBe(true);
      writeFileSync(b.reply, "");
      await second;
      texts = await userTexts(live, r);
    },
  });
  runs.push(result);
  return texts;
}

describe.skipIf(unavailable !== undefined)("a report held while dispose meets newer input", () => {
  it("serve: input routed to the re-created instance drops the old turn's report", {
    timeout: 400_000,
  }, async (ctx) => {
    const { b, texts } = await ordered(ctx, async () => {
      const b = barriers(true);
      const texts = await overtaken(b, () => reached(b, "Stop answered", () => saw(b, "answered")));
      return { b, texts };
    });
    const marked = timeline(b);
    expect(logged(b).slice(0, 4), marked).toEqual(["stop", "dispose", "input", "answered"]);
    expect(texts.some((t) => t.startsWith("think"))).toBe(true);
    expect(texts.some((t) => t.startsWith(INPUT))).toBe(true);
    expect(
      texts.filter((t) => t.includes(OLD)),
      marked,
    ).toEqual([]);
  });

  it("serve: an abort of the new turn, then the old Stop's answer, stores nothing", {
    timeout: 400_000,
  }, async (ctx) => {
    const { b, texts } = await ordered(ctx, async () => {
      const b = barriers(false);
      const texts = await overtaken(b, async (live, r) => {
        const planned = () => live.requests.filter((q) => q.model === PLANNED_MODEL);
        await reached(b, "the new turn's request", () => planned().length >= 2);
        expect(planned(), timeline(b)).toHaveLength(2);
        const aborted = await call(live, r, `/session/${live.sessionID}/abort`, "POST");
        expect(aborted.ok, timeline(b)).toBe(true);
        await reached(b, "the abort reached the listeners", () => saw(b, "aborted"));
        writeFileSync(b.release, "");
        await reached(b, "Stop answered", () => saw(b, "answered"));
      });
      return { b, texts };
    });
    const marked = timeline(b);
    expect(logged(b).slice(0, 3), marked).toEqual(["stop", "dispose", "input"]);
    expect(logged(b).indexOf("aborted"), marked).toBeLessThan(logged(b).indexOf("answered"));
    expect(texts.some((t) => t.startsWith(INPUT))).toBe(true);
    expect(
      texts.filter((t) => t.includes(OLD)),
      marked,
    ).toEqual([]);
  });
});
