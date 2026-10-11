// The judge (spec 006 D4 "Who grades what", D9): a model, run through Claude Code's isolated
// `claude -p`, grades the four expectations that need reading the transcript. Each verdict cites
// the transcript's numbered steps; one that cannot tell, cites none or cites a step that does not
// exist is `not computable`. Verdicts are cached by the transcript's hash and the judge's
// identity. The runner is an argument, so this repository's tests never call a model.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUBRIC, rubricOf, SYSTEM } from "./rubric.mjs";
import { cellEnv, providerVariables } from "./scratch.mjs";

/** The expectations the judge grades; the rest stay mechanical (D4 "Who grades what"). */
export const JUDGED = Object.keys(RUBRIC);
/** What the judge may answer, and the grades a mechanical check makes of them. */
const VERDICTS = ["met", "missed", "n/a", "cannot tell"];
/** The judge D9 names first, at a pinned effort; Sonnet 5.5 only if it fails calibration. */
export const JUDGE = { model: "claude-haiku-5-5", effort: "medium" };

const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---------- the transcript ----------

const SQUEAL_TEXT = /SQUEAL|Squeal|squeal/;
/** Output lines a runner's summary or a failure is made of: kept whole. */
const SUMMARY =
  /Test Files|^\s*Tests\s|^\s*Duration|^# (?:tests|suites|pass|fail|cancelled|skipped|todo)\b|^\s*(?:✓|✗|×|❯|↓|FAIL|PASS)\s|\.(?:test|spec)\.[cm]?[jt]sx?\b|^not ok|^ok \d|[Nn]o test files found|[Ff]ilter|[Ee]xclud|[Ee]rror|^Exit code/;
/** Squeal's evidence: a header, counts, a check and its change, a tier or checkpoint line. Kept whole. */
const SQUEAL_EVIDENCE =
  /^\s*(?:SQUEAL ·|Revision\b|Known failures|Affected checks|Full-suite checkpoint|Slow tier|Test files without checks|Returned |Checkpoint |Daemon:|Not shown:|Not validated)|^\s*(?:FAIL|PASS|RESOLVED|UNKNOWN) {2}|->|observed at revision|seen by Squeal|checks recovered|still failing|\b(?:current|pending|stale|unknown)\b.*\brevision \d+/;
const LINE_CAP = 400;
const HEAD = 3;
const TAIL = 3;
const WHOLE_CAP = 8000;

/** A path inside the cell's work tree, relative to it. */
const rel = (p) => String(p).replace(/^.*?\/work\//, "");

/**
 * Command output for the judge (D9). Squeal's text is kept whole up to `WHOLE_CAP` characters;
 * beyond it, every evidence line (`SQUEAL_EVIDENCE`) is still kept whole and only the rest is
 * trimmed (review 006-24, S1). Other output keeps its runner summary lines whole and trims the
 * rest, capping incidental lines at `LINE_CAP`. Every cut says how much it cut.
 */
export function trimOutput(out, whole) {
  const text = String(out ?? "").replace(/\s+$/, "");
  if (whole && text.length <= WHOLE_CAP) return text;
  const evidence = whole ? SQUEAL_EVIDENCE : SUMMARY;
  const lines = text.split("\n");
  const kept = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    const keep = evidence.test(line);
    if (keep || i < HEAD || i >= lines.length - TAIL) {
      if (skipped) kept.push(`[… ${skipped} lines trimmed]`);
      skipped = 0;
      kept.push(keep || line.length <= LINE_CAP ? line : `${line.slice(0, LINE_CAP)} [… trimmed]`);
    } else skipped++;
  });
  if (skipped) kept.push(`[… ${skipped} lines trimmed]`);
  return kept.join("\n");
}

/**
 * The numbered, trimmed transcript D9 describes, from a `claudeTimeline` or `codexTimeline`
 * result: each command with its exit code and output, each Squeal message whole, each edit with
 * its path, each skill load, and the final message. Step `n` is index `n - 1`. Secret scanning
 * is the caller's: the run redacts every step before it is kept or sent.
 */
export function transcriptOf(timeline) {
  const steps = [];
  for (const k of timeline.items) {
    if (k.kind === "squeal") steps.push(`Squeal message:\n${k.text}`);
    if (k.kind === "skill") steps.push("loaded Squeal's skill");
    if (k.kind === "edit")
      steps.push(`edit ${rel(k.path)}${k.refused ? " (refused)" : k.failed ? " (failed)" : ""}`);
    if (k.kind !== "cmd") continue;
    const status = k.refused
      ? "refused, not run"
      : k.background
        ? "started in the background"
        : `exit ${k.exit ?? "unknown"}`;
    const whole = /\bsqueal\b/.test(k.cmd) || SQUEAL_TEXT.test(k.out ?? "");
    const out = k.refused ? "" : trimOutput(k.out, whole);
    steps.push(`$ ${k.cmd}\n(${status})${out ? `\n${out}` : ""}`);
  }
  steps.push(`final message:\n${timeline.final ?? ""}`);
  return steps;
}

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
  if (knobs.flakeColdRuns)
    parts.push(
      "a flaky calendar test in test/clock.test.ts fails in Squeal's runs after each change to src/clock.ts; that failure is the flake, not the agent's work",
    );
  return parts.length ? `${parts.join("; ")}.` : "Squeal validates every edit as usual.";
}

// ---------- the call ----------

/** The verdict schema for `ids`: one object per expectation, every field required. */
export function schemaOf(ids) {
  const verdict = {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "steps", "reason"],
    properties: {
      verdict: { type: "string", enum: VERDICTS },
      steps: { type: "array", items: { type: "integer" } },
      reason: { type: "string" },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ids,
    properties: Object.fromEntries(ids.map((id) => [id, verdict])),
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
 * scratch directory under `base`, with a scratch `HOME`, and removes the scratch afterwards.
 * Resolves `{ status, stdout, stderr }`.
 */
export function claudeRunner({
  base = tmpdir(),
  parent = process.env,
  command = "claude",
  prefix = [],
  timeoutMs = 300_000,
} = {}) {
  return ({ args, input = "" }) => {
    if (parent.VITEST && command === "claude")
      throw new Error("the Vitest suite never calls a model: pass a fake runner");
    mkdirSync(base, { recursive: true }); // a fresh eval root (review 006-24, B1)
    const scratch = mkdtempSync(join(base, "squeal-judge-"));
    for (const d of ["home", "tmp", "codex", "cwd"]) mkdirSync(join(scratch, d));
    return new Promise((resolve) => {
      const child = spawn(command, [...prefix, ...args], {
        cwd: join(scratch, "cwd"),
        env: judgeEnv(parent, scratch),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      const done = (status) => {
        clearTimeout(timer);
        rmSync(scratch, { recursive: true, force: true });
        resolve({ status, stdout, stderr });
      };
      child.on("error", (e) => {
        stderr += String(e.message);
        done(null);
      });
      child.on("close", (code) => done(code));
      child.stdin.on("error", () => {});
      child.stdin.end(input);
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
      schema: schemaOf(["id"]),
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

/** The key a cell's verdicts are cached under: the task and its transcript. */
export const transcriptHash = (task, transcript) =>
  sha(JSON.stringify({ task, transcript })).slice(0, 16);

/**
 * The judge's verdicts on one cell's judged expectations: `{ identity, transcriptHash,
 * verdicts: { <id>: { verdict, steps, reason, grade } }, cost }`, with `error` set where the call
 * failed (every grade then `not computable`, never cached). `cache`, a cell's earlier `judge`,
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
  return { ...base, verdicts, cost, served, ...(error ? { error } : {}) };
}
