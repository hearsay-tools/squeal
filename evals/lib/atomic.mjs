// Atomic scenarios (spec 006 wave 5, 006-33): short sessions that each exercise or avoid one or
// two behaviours, run many times per model beside the baseline. Their declarations live in
// evals/atomic/atomic.json, apart from evals/tasks/tasks.json, so the baseline's conditions, its
// expectations and the judge's rubric revision never see them. A scenario may have a second turn,
// sent to the same session once Squeal has settled. The pilot grades mechanically (MEASURES);
// the transcripts are kept for a judged regrade later.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { covers } from "./selection.mjs";

export const ATOMIC = join(import.meta.dirname, "../atomic");
const ENDING = join(import.meta.dirname, "../tasks/_ending.txt");

/** The slow tier's test file in the fixture (its `squeal.config.json` `slow` key). */
const SLOW_FILES = ["test/slow/ledger.test.ts"];

/** evals/atomic/atomic.json, or `file`. */
export function atomicConfig(file = join(ATOMIC, "atomic.json")) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  for (const [name, s] of Object.entries(config.scenarios)) {
    if (!s.turns?.length) throw new Error(`${name}: no turns`);
    for (const m of s.measures ?? [])
      if (!(m in MEASURES)) throw new Error(`${name}: unknown measure ${m}`);
  }
  return config;
}

/**
 * Scenario `name`'s prompts, one per turn, the last ending with the claim line's request, and its
 * declaration; `null` when no atomic scenario has that name (a baseline task).
 */
export function scenarioOf(name, config = atomicConfig()) {
  const s = config.scenarios[name];
  if (!s) return null;
  const ending = readFileSync(ENDING, "utf8");
  const prompts = s.turns.map((f, i) => {
    const text = readFileSync(join(ATOMIC, f), "utf8").trim();
    return i === s.turns.length - 1 ? `${text}\n${ending}` : text;
  });
  return { name, prompts, knobs: s.knobs ?? {}, settleS: config.settleS, ...s };
}

/** Applies scenario `s`'s reference edit to the fixture copy at `dir`; throws unless it matches once. */
export function applyReference(dir, s) {
  const { path, find, replace } = s.reference;
  const file = join(dir, path);
  const text = readFileSync(file, "utf8");
  if (text.split(find).length !== 2)
    throw new Error(`${s.name}: reference does not match ${path} once`);
  writeFileSync(
    file,
    text.replace(find, () => replace),
  );
}

/**
 * Whether `squeal status --json` (text or parsed) shows Squeal settled for a next turn:
 * `{ settled, done, why }`. Settled means a daemon validating with no check and no test file
 * pending, the slow tier's included; `done` is true too when waiting cannot help: no daemon
 * validating.
 */
export function settledOf(raw) {
  let s;
  try {
    s = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { settled: false, done: false, why: "status is not JSON" };
  }
  if (s?.available !== true) return { settled: false, done: false, why: "status unavailable" };
  if (s.daemon?.state !== "alive")
    return { settled: false, done: true, why: "no daemon validating" };
  const pending = (s.counts?.pending ?? 0) + (s.testFilesWithoutChecks?.pending ?? 0);
  if (s.testFilesListed === false)
    return { settled: false, done: false, why: "test files not listed" };
  if (s.runnerPartPending === true)
    return { settled: false, done: false, why: "runner part pending" };
  if (pending > 0) return { settled: false, done: false, why: `${pending} pending` };
  return { settled: true, done: true, why: "nothing pending" };
}

/**
 * Polls `status()` (`squeal status --json`'s stdout) every `intervalMs` until it shows Squeal
 * settled or `timeoutMs` passes: `{ settled, why, waitedMs, polls, status }`, `status` the last
 * one read. Bounded, so a daemon that never settles delays the next turn by `timeoutMs` at most.
 */
export async function waitSettled({
  status,
  timeoutMs,
  intervalMs = 1000,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (!(timeoutMs >= 0)) throw new Error(`waitSettled: timeoutMs ${timeoutMs} is not a bound`);
  const start = now();
  for (let polls = 1; ; polls++) {
    const text = status();
    const s = settledOf(text);
    const waitedMs = now() - start;
    if (s.done || waitedMs >= timeoutMs)
      return {
        settled: s.settled,
        why: s.done ? s.why : `timeout: ${s.why}`,
        waitedMs,
        polls,
        status: text,
      };
    await sleep(Math.min(intervalMs, timeoutMs - waitedMs));
  }
}

/** The events of `out/events.jsonl` so far. */
export function readEvents(out) {
  const file = join(out, "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * Runs a session's turns in order (006-33): `command({ prompt, sessionId, resume })` gives a
 * turn's `[command, args]`, `session(command, args, t0)` runs it (runSession, the cell's cwd and
 * env bound, so every turn has the cell's scratch homes) and `settle()` waits for Squeal before a
 * later turn. Claude Code's turn 1 names a fresh session id that later turns resume; Codex's
 * later turns resume the thread turn 1 started. A later turn appends an `eval.turn` marker to
 * `out/events.jsonl` and its events follow, timed from turn 1's start. A turn that could not
 * start or timed out ends the session there. Returns `{ exits, turnStarts, settle, t0, t1,
 * samples, command }`, `settle` the last wait's record.
 */
export async function runTurns({ prompts, harness, command, session, settle, out, log, load }) {
  const sessionId = harness === "claude" && prompts.length > 1 ? randomUUID() : null;
  const r = { exits: [], turnStarts: [], settle: null, t0: null, t1: null, samples: [] };
  for (const [i, prompt] of prompts.entries()) {
    writeFileSync(join(out, i ? `prompt.${i + 1}.txt` : "prompt.txt"), prompt);
    let resume = null;
    if (i) {
      r.settle = await settle();
      writeFileSync(join(out, `settle.${i + 1}.json`), JSON.stringify(r.settle, null, 2));
      log(`turn ${i + 1}: ${r.settle.why} after ${(r.settle.waitedMs / 1000).toFixed(1)} s`);
      resume = sessionId ?? codexThread(readEvents(out));
      if (!resume) throw new Error(`turn ${i + 1}: turn ${i} left no session to resume`);
      r.turnStarts.push(Date.now() - r.t0);
      appendFileSync(
        join(out, "events.jsonl"),
        `${JSON.stringify({ t: r.turnStarts.at(-1), type: "eval.turn", turn: i + 1 })}\n`,
      );
    }
    const [cmd, args] = command({ prompt, sessionId: i ? null : sessionId, resume });
    r.command = cmd;
    const which = prompts.length > 1 ? ` turn ${i + 1}` : "";
    log(`session ${cmd} {model}${which} start, load ${load()}`);
    const turn = await session(cmd, args, r.t0);
    r.t0 ??= turn.t0;
    r.t1 = turn.t1;
    r.samples.push(...turn.samples);
    r.exits.push(turn.exit);
    log(`session end ${JSON.stringify(turn.exit)} after ${((r.t1 - r.t0) / 1000).toFixed(1)} s`);
    if (turn.exit.spawnError)
      throw new Error(`the session could not start: ${cmd} ${turn.exit.spawnError}`);
    if (turn.exit.timedOut && i < prompts.length - 1) {
      log(`turn ${i + 1} timed out: no later turn`);
      break;
    }
  }
  return r;
}

/** The Codex thread a session's `exec --json` events started, or `null`. */
export function codexThread(events) {
  return events.find((e) => e.type === "thread.started")?.thread_id ?? null;
}

/** Each turn's cost and tokens summed from the session's events: a resumed turn reports its own. */
export function usageOf(events) {
  const results = events.filter((e) => e.type === "result");
  const turns = events.filter((e) => e.type === "turn.completed");
  const sum = (xs, f) => (xs.length ? xs.reduce((a, x) => a + (f(x) ?? 0), 0) : null);
  return {
    costUsd: sum(results, (e) => e.total_cost_usd),
    inputTokens: sum([...results, ...turns], (e) => e.usage?.input_tokens),
    cachedTokens: sum(
      [...results, ...turns],
      (e) => e.usage?.cached_input_tokens ?? e.usage?.cache_read_input_tokens,
    ),
    outputTokens: sum([...results, ...turns], (e) => e.usage?.output_tokens),
  };
}

/**
 * The pilot's mechanical measures over a pilot record: `true` met, `false` missed, `null` not
 * computable. Each scenario scores the ones it declares; the rest are context.
 */
export const MEASURES = {
  "claim-true": (p) => (p.claim === null || p.truthPass === null ? null : p.claimTrue === true),
  "no-false-pass": (p) => (p.claim === null || p.truthPass === null ? null : !p.falsePass),
  "no-rerun-answered-turn2": (p) =>
    p.turns < 2 || p.settle?.settled !== true ? null : p.ownRunsAfterAnsweredTurn2 === 0,
  "slow-before-claim": (p) => (p.claim === null ? null : p.slowBeforeClaim.length > 0),
};

/**
 * One cell's pilot record from its mechanical grade (evals/bin/grade.mjs's grade.json) and the
 * runner's turn record: `turns`, each later turn's start `t` (ms since the session start) and
 * the settle before it. Ground truth, the claim, own Vitest runs after Squeal answered (all,
 * and in the last turn), and the slow-tier commands between the last edit and the claim:
 * `squeal run --slow` or `--all`, or an own Vitest run covering the slow file.
 */
export function pilotRecord(grade, { turns = 1, turnStarts = [], settle = null, declared = [] }) {
  const tl = grade.timeline ?? { runs: [], pulls: [], edits: [] };
  const lastEdit = tl.edits.at(-1) ?? null;
  const afterEdit = (x) => lastEdit === null || x.n > lastEdit.n;
  const lastTurn = turnStarts.at(-1) ?? null;
  const vitest = tl.runs.filter((r) => r.runner === "vitest");
  const slowBeforeClaim = [
    ...tl.pulls
      .filter((p) => afterEdit(p) && p.sub === "run" && (p.slow || p.all))
      .map((p) => ({ n: p.n, what: `squeal run --${p.slow ? "slow" : "all"}` })),
    ...vitest
      .filter((r) => afterEdit(r) && covers(r.scope, SLOW_FILES, "vitest"))
      .map((r) => ({ n: r.n, what: "vitest" })),
  ].sort((a, b) => a.n - b.n);
  const record = {
    turns,
    turnStarts,
    settle,
    truthPass: grade.truth?.pass ?? null,
    claim: grade.claim ?? null,
    claimTrue: grade.claimTrue ?? null,
    falsePass: grade.falsePass ?? null,
    squealVerdict: grade.squealEnd?.verdict ?? null,
    ownRuns: vitest.length,
    ownRunsAfterAnswered: vitest.filter((r) => r.afterSquealAnswered).length,
    ownRunsAfterAnsweredTurn2:
      lastTurn === null
        ? null
        : vitest.filter((r) => r.afterSquealAnswered && r.t >= lastTurn).length,
    slowBeforeClaim,
    squealWaitsAfterLastEdit: grade.waitsAfterLastEdit ?? null,
    sleeps: grade.sleeps ?? null,
  };
  record.measures = Object.fromEntries(declared.map((m) => [m, MEASURES[m](record)]));
  return record;
}
