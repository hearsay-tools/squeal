#!/usr/bin/env node
// Replays one scripted agent session in one worktree, with no model calls.
// It calls the Claude Code plugin's hooks the way Claude Code does (JSON on
// stdin, through hooks/run), edits files, and asks `squeal status --wait`
// for a verdict the way CLAUDE.md tells agents to. Every step is timed.
//
// Usage: node session.mjs --root <worktree> --plugin <plugin dir>
//          --files <testFiles> --seed <n> --steps <n> --out <file.jsonl>
//          [--think-min 3000] [--think-max 8000] [--broad-wait 300000]
//
// Step kinds:
//   benign  change a module's exported constant; tests must pass
//   break   make a module's function off by one; its tests must fail, and a
//           PostToolBatch hook must push the failure
//   fix     undo the break with new content (not a revert, so Squeal must
//           rerun, not reuse a stored result); a hook must push the recovery
//   status  plain `squeal status` and `squeal status --json`, timed
//   broad   (last step) change src/core.ts, which every test file imports,
//           then wait for the whole suite's verdict
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { rng, sleep, timed } from "./lib.mjs";

const { values: o } = parseArgs({
  options: {
    root: { type: "string" },
    plugin: { type: "string" },
    files: { type: "string" },
    seed: { type: "string", default: "1" },
    steps: { type: "string", default: "24" },
    out: { type: "string" },
    "think-min": { type: "string", default: "3000" },
    "think-max": { type: "string", default: "8000" },
    "broad-wait": { type: "string", default: "300000" },
    "push-wait": { type: "string", default: "60000" },
    // Issue 261: at plan step --ff-at, bring in the branch --ff-ref, as a coordinator does after a
    // merge: `git merge --ff-only` (mode merge) or, after committing its own edits, `git rebase` (mode rebase).
    "ff-at": { type: "string" },
    "ff-ref": { type: "string", default: "upstream" },
    "ff-mode": { type: "string", default: "merge" },
    "ff-wait": { type: "string", default: "900000" },
  },
});
const root = o.root;
const plugin = o.plugin;
const files = Number(o.files);
const random = rng(Number(o.seed));
const sessionId = randomUUID();
const GROUP = 25;
const NODE = process.execPath;
const env = {
  ...process.env,
  CLAUDE_PLUGIN_ROOT: plugin,
  CLAUDE_PROJECT_DIR: root,
};
const squealArgs = ["--disable-warning=ExperimentalWarning", join(plugin, "dist/cli/squeal.mjs")];

const record = (row) =>
  appendFileSync(o.out, `${JSON.stringify({ t: Date.now(), session: sessionId, ...row })}\n`);

function hook(name, payload, ifSqueal = false) {
  const args = [
    ...(ifSqueal ? ["--if-squeal"] : []),
    NODE,
    "--disable-warning=ExperimentalWarning",
    join(plugin, "dist", `${name}.mjs`),
  ];
  const input = JSON.stringify({
    session_id: sessionId,
    transcript_path: `/tmp/${sessionId}.jsonl`,
    cwd: root,
    permission_mode: "default",
    ...payload,
  });
  return timed(join(plugin, "hooks/run"), args, { input, env, cwd: root, timeoutMs: 30_000 }).then(
    (r) => {
      let text = null;
      if (r.stdout.trim() !== "") {
        try {
          const j = JSON.parse(r.stdout);
          text =
            j.hookSpecificOutput?.additionalContext ??
            j.hookSpecificOutput?.permissionDecisionReason ??
            j.reason ??
            null;
        } catch {
          text = r.stdout;
        }
      }
      record({
        kind: "hook",
        hook: name,
        ms: r.ms,
        code: r.code,
        delivered: text !== null,
        text: text === null ? null : text.slice(0, 1500),
      });
      return { ...r, text };
    },
  );
}

function squeal(args, timeoutMs = 900_000) {
  return timed(NODE, [...squealArgs, ...args], { env, cwd: root, timeoutMs });
}

// Module state, so a step knows what each file holds now.
const versions = new Map();
const broken = new Set();
let counter = 0;
function moduleSource(i) {
  const local = i % GROUP;
  const p = local === 0 ? null : i - local + Math.floor((local - 1) / 2);
  const imports = [`import { core } from "./core.js";`];
  if (p !== null) imports.push(`import { f${p} } from "./m${p}.js";`);
  const base = p === null ? "x" : `f${p}(x)`;
  const off = broken.has(i) ? " + 1" : "";
  return `${imports.join("\n")}\n\nexport const V${i} = ${versions.get(i) ?? 0};\n\nexport function f${i}(x: number): number {\n  return ${base} + core(${i}) + ${i}${off};\n}\n`;
}

async function edit(path, write) {
  const abs = join(root, path);
  const toolInput = { file_path: abs, old_string: "x", new_string: "y" };
  const pre = await hook(
    "pre-tool-use",
    {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: toolInput,
      tool_use_id: `toolu_${counter}`,
    },
    true,
  );
  const denied = pre.text !== null && /deny/i.test(pre.stdout);
  write(abs);
  const editedAt = performance.now();
  const post = await hook(
    "post-tool-batch",
    {
      hook_event_name: "PostToolBatch",
      tool_calls: [
        {
          tool_name: "Edit",
          tool_input: toolInput,
          tool_use_id: `toolu_${counter}`,
          tool_output: "ok",
          tool_output_error: false,
        },
      ],
    },
    true,
  );
  counter++;
  return { editedAt, post, denied };
}

/** Calls PostToolBatch about once a second, as an agent's later tool calls would, until `match` sees the push. */
async function awaitPush(editedAt, first, match) {
  if (first.text !== null && match(first.text)) return performance.now() - editedAt;
  const deadline = editedAt + Number(o["push-wait"]);
  while (performance.now() < deadline) {
    await sleep(1000);
    const r = await hook(
      "post-tool-batch",
      {
        hook_event_name: "PostToolBatch",
        tool_calls: [
          {
            tool_name: "Read",
            tool_input: { file_path: join(root, "README") },
            tool_use_id: `toolu_r${counter++}`,
            tool_output: "",
            tool_output_error: false,
          },
        ],
      },
      true,
    );
    if (r.text !== null && match(r.text)) return performance.now() - editedAt;
  }
  return null;
}

async function verdict(path, waitMs) {
  const r = await squeal(["status", "--wait", String(waitMs), path, "--json"], waitMs + 60_000);
  let wait = null;
  try {
    wait = JSON.parse(r.stdout).wait ?? null;
  } catch {
    // Reported below as outcome "unparsed".
  }
  return {
    ms: r.ms,
    outcome: wait?.outcome ?? "unparsed",
    result: wait?.result ?? null,
    waitedMs: wait?.waitedMs ?? null,
  };
}

const think = () =>
  sleep(Number(o["think-min"]) + random() * (Number(o["think-max"]) - Number(o["think-min"])));
const pickOne = () => {
  // 80% leaves or mid-tree modules, 20% group roots (which fan out to 25 test files).
  if (random() < 0.2) return Math.floor(random() * Math.ceil(files / GROUP)) * GROUP;
  let i;
  do i = Math.floor(random() * files);
  while (i % GROUP === 0);
  return i;
};
// In a fast-forward cell the incoming commit owns every module with i % 4 === 3 (run-cell.mjs,
// makeUpstream); the agent edits none of them, so its uncommitted edits never block the merge
// and a rebase never conflicts (2026-11-21: git refused a merge over three such edits).
const upstreamOwns = (i) => o["ff-at"] !== undefined && i % 4 === 3;
const pickModule = () => {
  let i;
  do i = pickOne();
  while (upstreamOwns(i));
  return i;
};

// The plan: benign edits, four break/fix pairs, a status check every fifth step, a broad edit last.
const steps = Number(o.steps);
const plan = [];
const breakAt = new Set([3, 8, 13, 18].filter((s) => s < steps - 2));
for (let s = 0; s < steps - 1; s++) {
  if (breakAt.has(s)) {
    plan.push("break", "fix");
    s++;
  } else if (s % 5 === 1) plan.push("status");
  else plan.push("benign");
}
plan.push("broad");
if (o["ff-at"] !== undefined) plan.splice(Number(o["ff-at"]), 0, "ff");
const gitEnv = {
  ...env,
  GIT_AUTHOR_NAME: "agent",
  GIT_AUTHOR_EMAIL: "agent@example.invalid",
  GIT_COMMITTER_NAME: "agent",
  GIT_COMMITTER_EMAIL: "agent@example.invalid",
};
const git = (args) => timed("git", args, { env: gitEnv, cwd: root, timeoutMs: 120_000 });
let ffAt = null;

/** After the fast-forward, before each later step: how many test files still wait. */
async function pollQueue(index) {
  const st = await squeal(["status", "--json"]);
  let pending = null;
  try {
    const j = JSON.parse(st.stdout);
    pending = j.testFileCounts?.pending ?? null;
  } catch {}
  record({ kind: "ff-poll", step: index, sinceFfMs: performance.now() - ffAt, pending });
}

/** The fast-forward (or rebase) step: the git command, the hook after it, and what Squeal queued. */
async function fastForward(index) {
  const mode = o["ff-mode"];
  if (mode === "rebase") {
    await git(["add", "-A"]);
    await git(["commit", "-qm", "own work before the rebase"]);
  }
  const command =
    mode === "rebase" ? ["rebase", "-q", o["ff-ref"]] : ["merge", "-q", "--ff-only", o["ff-ref"]];
  const g = await git(command);
  ffAt = performance.now();
  const post = await hook(
    "post-tool-batch",
    {
      hook_event_name: "PostToolBatch",
      tool_calls: [
        {
          tool_name: "Bash",
          tool_input: { command: `git ${command.join(" ")}` },
          tool_use_id: `toolu_ff${index}`,
          tool_output: g.stdout,
          tool_output_error: g.code !== 0,
        },
      ],
    },
    true,
  );
  await sleep(3000);
  const st = await squeal(["status", "--json"]);
  let counts = null;
  try {
    const j = JSON.parse(st.stdout);
    counts = { testFiles: j.testFileCounts, byPhase: j.testFilesByPhase };
  } catch {}
  record({
    kind: "step",
    step: index,
    type: "ff",
    mode,
    gitMs: g.ms,
    gitCode: g.code,
    gitErr: g.stderr.slice(0, 300),
    postMs: post.ms,
    ...counts,
  });
}

const start = await hook("session-start", {
  hook_event_name: "SessionStart",
  source: "startup",
  model: "claude-sonnet-5-5",
});
record({ kind: "session-start", ms: start.ms, text: start.text?.slice(0, 400) ?? null });

let brokenModule = null;
for (const [index, kind] of plan.entries()) {
  await think();
  if (kind === "ff") {
    await fastForward(index);
    continue;
  }
  if (ffAt !== null) await pollQueue(index);
  if (kind === "status") {
    const a = await squeal(["status"]);
    const b = await squeal(["status", "--json"]);
    record({
      kind: "step",
      step: index,
      type: "status",
      statusMs: a.ms,
      statusJsonMs: b.ms,
      code: a.code,
    });
    continue;
  }
  if (kind === "broad") {
    const { editedAt, post } = await edit("src/core.ts", (abs) => {
      writeFileSync(
        abs,
        readFileSync(abs, "utf8").replace(
          /CORE_VERSION = \d+/,
          `CORE_VERSION = ${Date.now() % 100000}`,
        ),
      );
    });
    const v = await verdict("src/core.ts", Number(o["broad-wait"]));
    record({
      kind: "step",
      step: index,
      type: "broad",
      postMs: post.ms,
      verdictMs: performance.now() - editedAt,
      ...v,
      correct: v.outcome === "settled" && v.result === "pass",
      wrong: v.outcome === "settled" && v.result !== "pass",
      late: v.outcome !== "settled",
    });
    continue;
  }
  const module = kind === "fix" ? brokenModule : pickModule();
  const path = `src/m${module}.ts`;
  if (kind === "break") {
    broken.add(module);
    brokenModule = module;
  }
  if (kind === "fix") broken.delete(module);
  versions.set(module, (versions.get(module) ?? 0) + 1);
  const { editedAt, post, denied } = await edit(path, (abs) =>
    writeFileSync(abs, moduleSource(module)),
  );
  let pushMs = null;
  if (kind === "break") pushMs = await awaitPush(editedAt, post, (t) => /(^|\n|-> )FAIL\b/.test(t));
  if (kind === "fix")
    pushMs = await awaitPush(editedAt, post, (t) => /FAIL -> PASS|recovered/.test(t));
  const v = await verdict(path, 60_000);
  const want = kind === "break" ? "fail" : "pass";
  record({
    kind: "step",
    step: index,
    type: kind,
    module,
    postMs: post.ms,
    denied,
    pushMs,
    pushOk: kind === "benign" ? null : pushMs !== null,
    verdictMs: performance.now() - editedAt,
    ...v,
    expected: want,
    correct: v.outcome === "settled" && v.result === want,
    wrong: v.outcome === "settled" && v.result !== want,
    late: v.outcome !== "settled",
  });
}

// After the session: how long from the fast-forward until every test file of the worktree is current.
if (ffAt !== null) {
  const wait = Number(o["ff-wait"]);
  const r = await squeal(["status", "--wait", String(wait), "--json"], wait + 60_000);
  let w = null;
  try {
    w = JSON.parse(r.stdout).wait ?? null;
  } catch {}
  record({
    kind: "ff-quiet",
    sinceFfMs: performance.now() - ffAt,
    outcome: w?.outcome ?? "unparsed",
  });
}

const stop = await hook("stop", {
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "Done.",
});
record({ kind: "stop", ms: stop.ms });
record({ kind: "end" });
