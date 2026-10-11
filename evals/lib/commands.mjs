// What one shell command does, as far as the grade cares (spec 006 D4): Squeal calls, the agent's
// own Vitest and node:test runs with their scope, sleeps, and file writes.
import { simpleCommands } from "./shell.mjs";

const VITEST_VALUE_FLAGS = new Set([
  "--reporter",
  "--config",
  "-c",
  "--project",
  "--root",
  "-r",
  "--dir",
  "--outputFile",
  "--pool",
  "--shard",
  "--environment",
  "--maxWorkers",
  "--minWorkers",
  "--testTimeout",
  "--mode",
]);

/**
 * Every action in shell text `text`, in the order it runs, one entry per simple command that
 * matters: `{ kind: "squeal", sub, wait, all, slow }`, `{ kind: "vitest" | "node:test", scope }`
 * with scope `full`, `files` or `name`, `{ kind: "sleep", seconds }` and `{ kind: "write", path }`.
 * A chain yields one action per command in it.
 *
 * Each action has an `execution` (review wave 1, B2): `refused` when the whole call was refused,
 * `executed` when the call's structure and `exit` establish it ran, else `indeterminate`. A
 * runner's own summary in `output` establishes as many indeterminate runs of it as it shows.
 */
export function classifyShell(text, { exit = null, output = "", refused = false } = {}) {
  const actions = [];
  for (const c of simpleCommands(text, { exit })) {
    const execution = refused ? "refused" : c.established ? "executed" : "indeterminate";
    const a = classify(c.words);
    if (a) actions.push({ ...a, execution });
    for (const path of writes(c)) actions.push({ kind: "write", path, execution });
  }
  return refused ? actions : withEvidence(actions, output);
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
/** What each runner prints once per run that ran. */
const SUMMARIES = {
  vitest: /^[ \t]*Test Files\s|No test files found|"numTotalTestSuites"/gm,
  "node:test": /^(?:# tests|\u2139 tests) \d+/gm,
  squeal: /^Known failures: \d+/gm,
};

function withEvidence(actions, output) {
  const text = String(output ?? "").replace(ANSI, "");
  for (const [kind, summary] of Object.entries(SUMMARIES)) {
    const ran = actions.filter((a) => a.kind === kind && a.execution === "executed").length;
    let spare = (text.match(summary)?.length ?? 0) - ran;
    for (const a of actions) {
      if (spare <= 0) break;
      if (a.kind === kind && a.execution === "indeterminate") {
        a.execution = "executed";
        spare--;
      }
    }
  }
  return actions;
}

const base = (w) => (w ?? "").replace(/^.*\//, "");

function classify(words) {
  const prog = base(words[0]);
  // squeal, squeal.mjs, `node <path>/squeal.mjs`, `npx squeal`
  let sq = -1;
  if (prog === "squeal" || prog === "squeal.mjs") sq = 0;
  else if (prog === "node" || prog === "npx")
    sq = words.findIndex((w, i) => i > 0 && /^(?:.*\/)?squeal(?:\.mjs)?$/.test(w));
  if (sq >= 0) {
    const rest = words.slice(sq + 1);
    const sub = rest.find((w) => !w.startsWith("-")) ?? "";
    return {
      kind: "squeal",
      sub,
      wait: rest.includes("--wait") || rest.some((w) => w.startsWith("--wait=")),
      all: rest.includes("--all"),
      slow: rest.includes("--slow"),
    };
  }
  const vitestArgs = vitestCall(prog, words);
  if (vitestArgs) return { kind: "vitest", scope: vitestScope(vitestArgs) };
  if (prog === "node" && words.includes("--test")) {
    const files = words.slice(words.indexOf("--test") + 1).filter((w) => !w.startsWith("-"));
    return {
      kind: "node:test",
      scope: files.length && !files.some((f) => f.includes("*")) ? "files" : "full",
    };
  }
  if (prog === "npm" && /^(?:run|run-script)$/.test(words[1] ?? "") && words[2] === "test:scripts")
    return { kind: "node:test", scope: "full" };
  if (prog === "sleep" && /^\d/.test(words[1] ?? ""))
    return { kind: "sleep", seconds: Number.parseFloat(words[1]) };
  return null;
}

/** The arguments after `vitest` when `words` runs Vitest, else `null`. */
function vitestCall(prog, words) {
  if (prog === "vitest") return words.slice(1);
  if (
    ["npx", "pnpx", "bunx"].includes(prog) ||
    (["pnpm", "yarn"].includes(prog) && words[1] === "exec")
  ) {
    const i = words.findIndex((w, j) => j > 0 && !w.startsWith("-") && w !== "exec");
    return i > 0 && base(words[i]).startsWith("vitest") ? words.slice(i + 1) : null;
  }
  if (prog === "node" && words.some((w) => /node_modules\/vitest\/vitest\.mjs$/.test(w)))
    return words.slice(2);
  if (["npm", "pnpm", "yarn"].includes(prog)) {
    const scriptAt = /^(?:run|run-script)$/.test(words[1] ?? "") ? 2 : 1;
    if (!/^(?:test|t)$/.test(words[scriptAt] ?? "")) return null;
    const dash = words.indexOf("--");
    return dash >= 0 ? words.slice(dash + 1) : words.slice(scriptAt + 1);
  }
  return null;
}

function vitestScope(args) {
  if (args.some((a) => a === "-t" || a.startsWith("--testNamePattern") || a.startsWith("-t=")))
    return "name";
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VITEST_VALUE_FLAGS.has(a)) i++;
    else if (!a.startsWith("-") && !["run", "watch", "related"].includes(a)) files.push(a);
  }
  return files.length ? "files" : "full";
}

/** Paths a command writes: redirections, `tee`, `sed -i`, `perl -i`, `apply_patch` bodies. */
function writes(c) {
  const paths = c.redirects.filter((r) => /^>/.test(r.op)).map((r) => r.target);
  const prog = base(c.words[0]);
  const args = c.words.slice(1);
  if (prog === "tee") paths.push(...args.filter((a) => !a.startsWith("-")));
  if (
    (prog === "sed" || prog === "perl") &&
    args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))
  ) {
    const operands = [];
    let script = args.some((a) => a === "-e" || a === "--expression");
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-e" || args[i] === "--expression") i++;
      else if (!args[i].startsWith("-")) {
        if (script) operands.push(args[i]);
        else script = true;
      }
    }
    paths.push(...operands);
  }
  if (prog === "apply_patch" || c.words.includes("apply_patch")) {
    for (const body of [...c.heredocs, ...args]) {
      for (const m of body.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm))
        paths.push(m[1].trim());
    }
  }
  return paths.filter((p) => p && !/^\/dev\//.test(p) && !/^\d+$/.test(p));
}
