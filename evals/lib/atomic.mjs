// Atomic scenarios (spec 006 wave 5, 006-33): short sessions that each exercise or avoid one or
// two behaviours, run many times per model beside the baseline. Their declarations live in
// evals/atomic/atomic.json, apart from evals/tasks/tasks.json, so the baseline's conditions, its
// expectations and the judge's rubric revision never see them. A scenario may have a second turn,
// sent to the same session once Squeal has settled, or at once where the question must arrive
// while checks run (D10). Graded mechanically (atomic-measures.mjs); the transcripts are kept for
// a judged regrade later.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEASURES } from "./atomic-measures.mjs";

export { MEASURES, measuresOf, pilotRecord, regradeAtomic } from "./atomic-measures.mjs";

export const ATOMIC = join(import.meta.dirname, "../atomic");
const ENDING = join(import.meta.dirname, "../tasks/_ending.txt");

/** Squeal's default `slow.maxDeferMs` (src/core/types/policy.ts): the load guard's longest deferral. */
export const MAX_DEFER_MS = 600_000;

/** evals/atomic/atomic.json, or `file`. */
export function atomicConfig(file = join(ATOMIC, "atomic.json")) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  for (const [name, s] of Object.entries(config.scenarios)) {
    if (!s.turns?.length) throw new Error(`${name}: no turns`);
    for (const m of s.measures ?? [])
      if (!(m in MEASURES)) throw new Error(`${name}: unknown measure ${m}`);
    if (s.measures?.includes("own-run-covers") && !s.ownRun?.files?.length)
      throw new Error(`${name}: own-run-covers needs ownRun's runner, files and after`);
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
 * `{ settled, done, why, pending, deferred }`. Settled means every result current: no check or
 * test file pending, stale or unknown, the slow tier's included. A headless session's daemon
 * drains its work and exits when the session ends, so a stopped daemon whose results are all
 * current is settled too (006-34's first cells); a stopped daemon with work left is done, since
 * waiting cannot help. `pending` says checks were still to run; `deferred` that the slow tier
 * waits for its load gate, which counts as not started (D10): it has not run long, it has not
 * begun.
 */
export function settledOf(raw) {
  let s;
  try {
    s = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { settled: false, done: false, why: "status is not JSON", pending: false, deferred: false };
  }
  if (s?.available !== true)
    return { settled: false, done: false, why: "status unavailable", pending: false, deferred: false };
  const open = openWork(s);
  const activity = s.slowTier?.activity;
  const deferred = activity?.kind === "waiting" && activity.for === "load";
  const state = { pending: pendingOf(s), deferred };
  if (s.daemon?.state !== "alive")
    return open
      ? { settled: false, done: true, why: `no daemon validating, ${open}`, ...state }
      : { settled: true, done: true, why: "nothing pending, the daemon drained and stopped", ...state };
  if (open)
    return {
      settled: false,
      done: false,
      why: deferred ? `${open}, the slow tier not started: deferred by load` : open,
      ...state,
    };
  return { settled: true, done: true, why: "nothing pending", ...state };
}

/** Whether checks or test files are still to run, the slow tier's included. */
function pendingOf(s) {
  const slow = (s.slowPending?.testFiles ?? 0) + (s.slowTier?.pending ?? 0);
  const pending = (s.counts?.pending ?? 0) + (s.testFilesWithoutChecks?.pending ?? 0);
  return s.testFilesListed === false || s.runnerPartPending === true || pending + slow > 0;
}

/** What still keeps a status from being current, or null. */
function openWork(s) {
  if (s.testFilesListed === false) return "test files not listed";
  if (s.runnerPartPending === true) return "runner part pending";
  const slow = (s.slowPending?.testFiles ?? 0) + (s.slowTier?.pending ?? 0);
  const pending = (s.counts?.pending ?? 0) + (s.testFilesWithoutChecks?.pending ?? 0);
  if (pending > 0 || slow > 0) return `${pending + slow} pending`;
  const open =
    (s.counts?.stale ?? 0) + (s.counts?.unknown ?? 0) + (s.testFilesWithoutChecks?.unknown ?? 0);
  return open > 0 ? `${open} stale or unknown` : null;
}

/** The fixture copy at `dir`'s `slow.maxDeferMs`, or Squeal's default. */
export function maxDeferMsOf(dir) {
  const file = join(dir, "squeal.config.json");
  const ms = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).slow?.maxDeferMs : undefined;
  return typeof ms === "number" ? ms : MAX_DEFER_MS;
}

/**
 * Polls `status()` (`squeal status --json`'s stdout) every `intervalMs` until it shows Squeal
 * settled or the bound passes: `{ settled, why, waitedMs, polls, status, pending }`, `status` the
 * last one read. The bound is `timeoutMs`; once a poll shows the slow tier deferred by its load
 * gate (D10), it is `maxDeferMs` plus the tier's last duration (the longest `lastDurationMs` a
 * running tier showed, else `timeoutMs`), if that is longer. Bounded, so a daemon that never
 * settles delays the next turn by that much at most.
 */
export async function waitSettled({
  status,
  timeoutMs,
  maxDeferMs = MAX_DEFER_MS,
  intervalMs = 1000,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (!(timeoutMs >= 0)) throw new Error(`waitSettled: timeoutMs ${timeoutMs} is not a bound`);
  const start = now();
  let boundMs = timeoutMs;
  let lastMs = null;
  for (let polls = 1; ; polls++) {
    const text = status();
    const s = settledOf(text);
    const ran = parsed(text)?.slowTier?.activity;
    if (ran?.kind === "running" && typeof ran.lastDurationMs === "number")
      lastMs = Math.max(lastMs ?? 0, ran.lastDurationMs);
    if (s.deferred) boundMs = Math.max(boundMs, maxDeferMs + (lastMs ?? timeoutMs));
    const waitedMs = now() - start;
    if (s.done || waitedMs >= boundMs)
      return {
        settled: s.settled,
        why: s.done ? s.why : `timeout: ${s.why}`,
        waitedMs,
        polls,
        status: text,
        pending: s.pending,
      };
    await sleep(Math.min(intervalMs, boundMs - waitedMs));
  }
}

/**
 * A later turn sent without waiting (a scenario's `waitSettled: false`, D10 a4-pending): one read
 * of `status()`, recording whether checks were still pending as the turn was sent.
 */
export function settleSnapshot(status) {
  const text = status();
  const s = settledOf(text);
  return {
    settled: s.settled,
    why: `not waited: ${s.why}`,
    waitedMs: 0,
    polls: 1,
    status: text,
    pending: s.pending,
  };
}

const parsed = (text) => {
  try {
    return typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return null;
  }
};

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
