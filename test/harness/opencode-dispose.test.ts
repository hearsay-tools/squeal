import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
 */

const unavailable = opencodeUnavailable();
if (unavailable && process.env.CI)
  throw new Error(`OpenCode fixture unavailable on CI: ${unavailable}`);

const OLD = "SQUEAL · old turn report";
const INPUT = "new input";

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
  /** Lines in order: `stop`, `dispose`, `input`, `aborted`, `answered`, `disposed`. */
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
if (once) appendFileSync(${JSON.stringify(log)}, "stop\\n");
const answer = (report) => process.stdout.write(JSON.stringify({ answer: { report } }));
if (!once) answer(null);
else {
  const timer = setInterval(() => {
    if (!existsSync(${JSON.stringify(release)})) return;
    clearInterval(timer);
    appendFileSync(${JSON.stringify(log)}, "answered\\n");
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
const mark = (line) => appendFileSync(${JSON.stringify(log)}, line + "\\n");
export const Squeal = async (input) => {
  const hooks = await mod.server(input);
  return {
    ...hooks,
    async event(arg) {
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

const logged = (b: Barriers) => readFileSync(b.log, "utf8").split("\n").filter(Boolean);
const saw = (b: Barriers, line: string) => logged(b).includes(line);

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
      await expect.poll(() => saw(b, "stop"), { timeout: 30_000 }).toBe(true);
      const disposing = call(live, r, "/instance/dispose", "POST");
      await expect.poll(() => saw(b, "dispose"), { timeout: 30_000 }).toBe(true);
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
    timeout: 180_000,
  }, async () => {
    const b = barriers(true);
    const texts = await overtaken(b, async () => {
      await expect.poll(() => saw(b, "answered"), { timeout: 30_000 }).toBe(true);
    });
    expect(logged(b).slice(0, 4)).toEqual(["stop", "dispose", "input", "answered"]);
    expect(texts.some((t) => t.startsWith("think"))).toBe(true);
    expect(texts.some((t) => t.startsWith(INPUT))).toBe(true);
    expect(texts.filter((t) => t.includes(OLD))).toEqual([]);
  });

  it("serve: an abort of the new turn, then the old Stop's answer, stores nothing", {
    timeout: 180_000,
  }, async () => {
    const b = barriers(false);
    const texts = await overtaken(b, async (live, r) => {
      const planned = () => live.requests.filter((q) => q.model === PLANNED_MODEL);
      await expect.poll(() => planned().length, { timeout: 30_000 }).toBe(2);
      expect((await call(live, r, `/session/${live.sessionID}/abort`, "POST")).ok).toBe(true);
      await expect.poll(() => saw(b, "aborted"), { timeout: 30_000 }).toBe(true);
      writeFileSync(b.release, "");
      await expect.poll(() => saw(b, "answered"), { timeout: 30_000 }).toBe(true);
    });
    expect(logged(b).slice(0, 3)).toEqual(["stop", "dispose", "input"]);
    expect(logged(b).indexOf("aborted")).toBeLessThan(logged(b).indexOf("answered"));
    expect(texts.some((t) => t.startsWith(INPUT))).toBe(true);
    expect(texts.filter((t) => t.includes(OLD))).toEqual([]);
  });
});
