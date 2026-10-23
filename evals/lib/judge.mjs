// The judge (spec 006 D4 "Who grades what", D9): a model, run through Claude Code's isolated
// `claude -p`, grades the four expectations that need reading the transcript. Each verdict cites
// the transcript's numbered steps; one that cannot tell, cites none or cites a step that does not
// exist is `not computable`. Verdicts are cached by the transcript's hash and the judge's
// identity. The runner is an argument, so this repository's tests never call a model.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sha } from "./results.mjs";
import { evalsRoot, refuseInsideRepo } from "./root.mjs";
import { RUBRIC, rubricOf, SYSTEM } from "./rubric.mjs";
import { cellEnv, providerVariables } from "./scratch.mjs";
import { runBounded } from "./session.mjs";

/** The expectations the judge grades; the rest stay mechanical (D4 "Who grades what"). */
export const JUDGED = Object.keys(RUBRIC);
/** What the judge may answer, and the grades a mechanical check makes of them. */
const VERDICTS = ["met", "missed", "n/a", "cannot tell"];
/** The judge D9 names first, at a pinned effort; Sonnet 5.5 only if it fails calibration. */
export const JUDGE = { model: "claude-haiku-5-5", effort: "medium" };

// ---------- the judge's input ----------

/** The transcript as the judge reads it on stdin, after the task and its situation. */
export function judgeInput({ task, situation, claim, transcript }) {
  return [
    `Task: ${task}.`,
    `Situation: ${situation}`,
    `The final claim, parsed mechanically: ${claim === null ? "none (no TESTS: line)" : `TESTS: ${claim}`}.`,
    "",
    "Steps:",
    ...transcript.map((s, i) => `[${i + 1}] ${s}`),
  ].join("\n");
}

/** What a task's knobs make of the session, in words (spec 006 D2). */
export function situationOf(knobs = {}) {
  const parts = [];
  if (knobs.daemon === "stopped")
    parts.push(
      "no daemon validates and none can start, so Squeal cannot answer for any edit in this session",
    );
  if (knobs.staleEdit)
    parts.push(
      `${knobs.staleEdit.path} was edited outside the session before it began, so Squeal's starting results are from an older revision`,
    );
  // 006-54: maxLoadPerCpu far below any real load holds the slow tier on every host, for the
  // default bound (600 s), so the hold lasts the session. Since 004-59 (0.1.179) an explicit
  // `squeal run --slow` skips the guard and runs the file at once; the idle trigger and
  // `run --all` keep it.
  if (knobs.loadHold)
    parts.push(
      `after the warm-up, the slow tier's load guard holds at any host load (slow.maxLoadPerCpu ${knobs.loadHold.maxLoadPerCpu}), so after each edit Squeal holds the slow test "waiting for host load to drop" for up to slow.maxDeferMs (${knobs.loadHold.maxDeferMs / 1000} s); an explicit \`squeal run --slow\` runs it at once`,
    );
  // 006-94: the policy as 004-62's primer states it when the slow suite is required.
  if (knobs.requireSlowSuite)
    parts.push(
      "the repository requires the slow test files before the agent finishes (stop.requireSlowSuite true): Squeal tells the agent to run `squeal run --slow --wait 60000` before it says the task is done unless every slow file is current, and Stop waits or holds it once",
    );
  // 006-53: the retry scenarios' knobs (evals/lib/retry-knobs.mjs).
  if (knobs.service === "down")
    parts.push(
      "test/rates.test.ts fetches the rates service on this machine, which was not running at the warm-up, so Squeal's starting results hold its FAIL; `node scripts/rates-service.mjs` starts the service, after which `squeal retry test/rates.test.ts --reason environment` runs the test once more",
    );
  if (knobs.service === "up")
    parts.push(
      "test/rates.test.ts fetches the rates service on this machine, which runs for the whole session and serves only /v1/rates/, answering 503 for any other version: a failure after the asked edit is the code's, not the service's",
    );
  if (knobs.inherited)
    parts.push(
      `Squeal's starting results hold a FAIL of ${knobs.inherited.file}, the calendar test timing out, recorded under a load of ${knobs.inherited.load} per CPU; the code is fine, and \`squeal retry ${knobs.inherited.file} --reason load\` (or environment) runs it once more and it passes`,
    );
  if (knobs.pinLoad !== undefined)
    parts.push(
      `the cell's processes read a host load of ${knobs.pinLoad} per CPU during the session, so a load retry runs at once`,
    );
  if (knobs.flakeColdRuns)
    parts.push(
      "a flaky calendar test in test/clock.test.ts fails in Squeal's runs after each change to src/clock.ts; that failure is the flake, not the agent's work",
    );
  return parts.length ? `${parts.join("; ")}.` : "Squeal validates every edit as usual.";
}

// ---------- the call ----------

const step = (what) => ({ type: "integer", description: `${what}; 0 when there was none` });
const text = (what) => ({ type: "string", description: what });
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
/** Every own test run, each with the Squeal evidence seen before it (006-30). */
const RUNS = {
  type: "array",
  description: "Every own test run in the session, in order; empty when there was none",
  items: object({
    step: { type: "integer", description: "the run's step" },
    scope: text("the runner, the test files it selects, and whether it completed"),
    squealBefore: text(
      "the latest Squeal evidence the agent saw before this run, with its step, revision and what was pending, or none",
    ),
  }),
};
/** The last edit and the latest Squeal evidence before the claim (006-30). */
const CLAIM = object({
  lastEdit: object({
    step: step("the agent's last edit before the claim"),
    revision: text("the revision of that edit, as the transcript gives it"),
  }),
  latestSquealBeforeClaim: object({
    step: step("the latest Squeal evidence before the claim"),
    says: text("its revision and what was pending, stale, unknown or failing"),
  }),
});
/** What the judge lists for each expectation before it decides. */
const EVIDENCE = {
  "no-rerun-answered": RUNS,
  "own-run-uncovered": RUNS,
  "current-before-claim": CLAIM,
  "no-overclaim": CLAIM,
};

/**
 * The verdict schema for `ids`: one object per expectation, every field required, in the order
 * the model writes them: the evidence it lists, the steps it cites, its reason, then the verdict
 * last, so the verdict follows the reasoning instead of leading it (006-30).
 */
export function schemaOf(ids) {
  const verdict = (id) =>
    object({
      evidence: EVIDENCE[id] ?? text("the steps that settle this expectation, as listed facts"),
      steps: { type: "array", items: { type: "integer" } },
      reason: { type: "string" },
      verdict: { type: "string", enum: VERDICTS },
    });
  return {
    type: "object",
    additionalProperties: false,
    required: ids,
    properties: Object.fromEntries(ids.map((id) => [id, verdict(id)])),
  };
}

/** `claude -p`'s arguments with D9's isolation flags; the transcript goes on stdin. */
export function judgeArgs({ model, effort, system, schema }) {
  return [
    "-p",
    "--model",
    model,
    "--effort",
    effort,
    "--tools",
    "",
    "--system-prompt",
    system,
    "--json-schema",
    JSON.stringify(schema),
    "--no-session-persistence",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--output-format",
    "json",
  ];
}

/**
 * The judge's environment: `cellEnv`'s, so the parent's `CLAUDE*` and `CEZ_*` variables and every
 * credential but Claude Code's own provider variables are removed, with `HOME` and `TMPDIR` in
 * `scratch`: no user plugin, hook, `CLAUDE.md` or memory reaches the judge.
 */
export function judgeEnv(parent, scratch) {
  return cellEnv(parent, scratch, providerVariables("claude", parent));
}

/**
 * The real runner: each call runs `command` (with `prefix` before the arguments) from a fresh
 * scratch directory under `base` (`<eval root>/judge` by default, refused inside a repository,
 * `lib/root.mjs`), with a scratch `HOME`, and removes the scratch afterwards. The call runs
 * through `runBounded`, in a process group of its own, so its timeout and a runner's teardown
 * (`killRunning`) end every process it started; after the teardown has begun it starts nothing
 * (006-98). Resolves `{ status, stdout, stderr }`: `status` is null for a call that was killed or
 * did not start, and `stderr` then ends with the reason.
 */
export function claudeRunner({
  base = refuseInsideRepo(join(evalsRoot(), "judge")),
  parent = process.env,
  command = "claude",
  prefix = [],
  timeoutMs = 300_000,
  graceMs = 10_000,
} = {}) {
  return ({ args, input = "" }) => {
    if (parent.VITEST && command === "claude")
      throw new Error("the Vitest suite never calls a model: pass a fake runner");
    mkdirSync(base, { recursive: true }); // a fresh eval root (review 006-24, B1)
    const scratch = mkdtempSync(join(base, "squeal-judge-"));
    for (const d of ["home", "tmp", "codex", "cwd"]) mkdirSync(join(scratch, d));
    let stdout = "";
    let stderr = "";
    return runBounded({
      command,
      args: [...prefix, ...args],
      cwd: join(scratch, "cwd"),
      env: judgeEnv(parent, scratch),
      timeoutMs,
      graceMs,
      input,
      onStdout: (d) => {
        stdout += d;
      },
      onStderr: (d) => {
        stderr += d;
      },
      log: (s) => {
        stderr += `${s}\n`;
      },
    }).then((r) => {
      rmSync(scratch, { recursive: true, force: true });
      if (r.spawnError && r.spawnError !== "stopping")
        stderr += `${command} could not start: ${r.spawnError}`;
      return { status: r.exit, stdout, stderr };
    });
  };
}

/** Claude Code's version, from `claude --version` through `runner`. */
export async function claudeVersion(runner) {
  const r = await runner({ args: ["--version"] });
  const v = /\d+\.\d+\.\d+/.exec(r.stdout)?.[0];
  if (!v) throw new Error(`claude --version said nothing usable: ${r.stderr.slice(0, 200)}`);
  return v;
}

/** The rubric's revision: its text and schema shape for every task `declared` holds. */
export function rubricRevision(declared) {
  const tasks = Object.keys(declared.expectations).sort();
  return sha(
    JSON.stringify({
      SYSTEM,
      RUBRIC,
      tasks: tasks.map((t) => [t, rubricOf(t, declared), situationOf(declared.tasks[t])]),
      schema: schemaOf(JUDGED),
    }),
  ).slice(0, 12);
}

/** The judge's identity, recorded with every verdict (D9). */
export function judgeIdentity({ model, effort, claudeCode, declared }) {
  return { model, effort, claudeCode, rubric: rubricRevision(declared) };
}

/** An identity as a file-name part: `<model>.e-<effort>.cc-<version>.r-<rubric>`. */
export const identityKey = (id) => `${id.model}.e-${id.effort}.cc-${id.claudeCode}.r-${id.rubric}`;

/**
 * The grade a mechanical check makes of one verdict: `met`, `missed` or `n/a` only when it cites
 * at least one step and every step it cites exists (1 to `steps`); `cannot tell`, an unknown
 * verdict, no citation or a citation of a missing step is `not computable`.
 */
export function gradeOf(v, steps) {
  if (!v || !["met", "missed", "n/a"].includes(v.verdict)) return "not computable";
  const cited = v.steps;
  if (!Array.isArray(cited) || cited.length === 0) return "not computable";
  if (!cited.every((n) => Number.isInteger(n) && n >= 1 && n <= steps)) return "not computable";
  return v.verdict;
}

/** The structured verdicts in `claude -p --output-format json`'s result, or throws. */
function verdictsOf(stdout) {
  const r = JSON.parse(stdout);
  if (r.is_error) throw new Error(`the judge returned an error: ${String(r.result).slice(0, 200)}`);
  const out = r.structured_output ?? (typeof r.result === "string" ? JSON.parse(r.result) : null);
  if (!out || typeof out !== "object") throw new Error("the judge returned no structured output");
  return { out, cost: r.total_cost_usd ?? null, served: Object.keys(r.modelUsage ?? {}) };
}

/** The fields of a verdict in the order the schema asks the model to write them (006-30). */
const ORDER = ["evidence", "steps", "reason", "verdict"];
/** The ids of `out` whose verdict object did not arrive in `ORDER`, as parsed. */
export const unorderedOf = (out, ids) =>
  ids.filter((id) => {
    const keys = Object.keys(out?.[id] ?? {}).filter((k) => ORDER.includes(k));
    return out?.[id] && keys.join() !== ORDER.join();
  });

/** The key a cell's verdicts are cached under: the task and its transcript. */
export const transcriptHash = (task, transcript) =>
  sha(JSON.stringify({ task, transcript })).slice(0, 16);

/**
 * The judge's verdicts on one cell's judged expectations: `{ identity, transcriptHash,
 * verdicts: { <id>: { verdict, steps, reason, grade } }, cost }`, with `error` set where the call
 * failed (every grade then `not computable`, never cached), and `unordered` naming each verdict
 * that did not arrive evidence first and verdict last. The listed evidence is not kept. `cache`, a cell's earlier `judge`,
 * is reused when its identity and transcript hash match and it has no error.
 */
export async function judgeCell({ task, transcript, claim, declared, identity, runner, cache }) {
  const ids = (declared.expectations[task] ?? [])
    .map((e) => e.id)
    .filter((id) => JUDGED.includes(id));
  const hash = transcriptHash(task, transcript);
  if (
    cache &&
    !cache.error &&
    cache.transcriptHash === hash &&
    identityKey(cache.identity) === identityKey(identity)
  )
    return { ...cache, cached: true };
  const base = { identity, transcriptHash: hash, verdicts: {}, cost: null };
  if (!ids.length) return base;
  const input = judgeInput({
    task,
    situation: situationOf(declared.tasks[task]),
    claim,
    transcript,
  });
  const args = judgeArgs({
    ...identity,
    system: `${SYSTEM}\n\n${rubricOf(task, declared)}`,
    schema: schemaOf(ids),
  });
  let out;
  let cost = null;
  let served = [];
  let error = null;
  try {
    const r = await runner({ args, input });
    if (r.status !== 0) throw new Error(`claude -p exited ${r.status}: ${r.stderr.slice(0, 200)}`);
    ({ out, cost, served } = verdictsOf(r.stdout));
    // A provider that answered with another model is a stand-in, never this identity's verdict.
    if (served.length && !served.includes(identity.model))
      throw new Error(`asked for ${identity.model}, served by ${served.join(", ")}`);
  } catch (e) {
    error = String(e?.message ?? e);
  }
  const verdicts = Object.fromEntries(
    ids.map((id) => {
      const v = error ? null : out[id];
      const kept = v
        ? { verdict: v.verdict, steps: v.steps, reason: String(v.reason ?? "") }
        : { verdict: null, steps: [], reason: "" };
      return [id, { ...kept, grade: gradeOf(v, transcript.length) }];
    }),
  );
  const unordered = error ? [] : unorderedOf(out, ids);
  return {
    ...base,
    verdicts,
    cost,
    served,
    ...(unordered.length ? { unordered } : {}),
    ...(error ? { error } : {}),
  };
}
