// What one shell command does, as far as the grade cares (spec 006 D4): Squeal calls, the agent's
// own Vitest and node:test runs with their scope, sleeps, and file writes.
import { readFileSync } from "node:fs";
import { simpleCommands } from "./shell.mjs";

/** The Ledgerline fixture's npm scripts: what `npm test` and `npm run test:scripts` run. */
const SCRIPTS = JSON.parse(
  readFileSync(new URL("../ledgerline/package.json", import.meta.url), "utf8"),
).scripts;

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
  "--hookTimeout",
  "--mode",
  "--exclude",
  "--bail",
  "--retry",
  "-t",
  "--testNamePattern",
]);
const NODE_VALUE_FLAGS = new Set([
  "--test-reporter",
  "--test-reporter-destination",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-timeout",
  "--test-shard",
  "--import",
  "--require",
  "-r",
  "--loader",
  "--experimental-loader",
  "--conditions",
  "-C",
  "--env-file",
]);
/** Vitest subcommands, and those that run no test: listing, watching, benchmarks. */
const VITEST_SUBCOMMANDS = new Set(["run", "watch", "dev", "related", "list", "bench"]);
const VITEST_NO_RUN = new Set(["watch", "dev", "list", "bench"]);
const HELP = new Set(["--help", "-h", "--version", "-v"]);

/**
 * Every action in shell text `text`, in the order it runs, one entry per simple command that
 * matters: `{ kind: "squeal", sub, wait, all, slow }` (and `paths`, `reason`, `cancel` for
 * `retry`), a test action, `{ kind: "sleep", seconds }`, `{ kind: "service" }` for a start of the
 * retry scenarios' rates service and `{ kind: "write", path }`. A chain yields one action per command in it.
 *
 * A test action (wave 2.6's contract, review wave 2.5 B3) is `{ kind, runner, informational,
 * scope }`, `kind` and `runner` both `vitest` or `node:test`. `informational` is true for help,
 * version, listing and watch-only invocations, which never count as a run. `scope` is `{ full:
 * true }` for the runner's whole suite or `{ full: false, paths }` with the paths and globs it
 * selects as written, plus `related` for the source files of `vitest related`, `changed` for
 * `--changed`, and the filters that narrow it (`testRun`). An npm script resolves to what it runs.
 *
 * Each action has an `execution` (review wave 1, B2): `refused` when the whole call was refused,
 * `executed` when the call's structure and `exit` establish it ran, else `indeterminate`. A
 * runner's own summary in `output` establishes as many indeterminate runs of it as it shows. A
 * command after an established `exit` or `exec` never ran and yields no action (review wave 1.5,
 * B2), so no output can establish it.
 */
export function classifyShell(text, { exit = null, output = "", refused = false } = {}) {
  const actions = [];
  for (const c of simpleCommands(text, { exit })) {
    if (c.unreachable) continue;
    const execution = refused ? "refused" : c.established ? "executed" : "indeterminate";
    for (const a of classify(c.words)) actions.push({ ...a, execution });
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

function classify(words, depth = 0) {
  const prog = base(words[0]);
  // squeal, squeal.mjs, `node <path>/squeal.mjs`, `npx squeal`
  let sq = -1;
  if (prog === "squeal" || prog === "squeal.mjs") sq = 0;
  else if (prog === "node" || prog === "npx")
    sq = words.findIndex((w, i) => i > 0 && /^(?:.*\/)?squeal(?:\.mjs)?$/.test(w));
  if (sq >= 0) {
    const rest = words.slice(sq + 1);
    const sub = rest.find((w) => !w.startsWith("-")) ?? "";
    return [
      {
        kind: "squeal",
        sub,
        wait: rest.includes("--wait") || rest.some((w) => w.startsWith("--wait=")),
        all: rest.includes("--all"),
        slow: rest.includes("--slow"),
        ...(sub === "retry" ? retryArgs(rest.slice(rest.indexOf(sub) + 1)) : {}),
      },
    ];
  }
  if (serviceStart(words)) return [{ kind: "service" }];
  const script = scriptCall(prog, words);
  if (script) {
    const body = SCRIPTS[script.name];
    if (typeof body !== "string" || depth > 2) return [];
    const text = [body, ...script.args.map((a) => `'${a.replaceAll("'", "'\\''")}'`)].join(" ");
    return simpleCommands(text)
      .flatMap((c) => classify(c.words, depth + 1))
      .filter((a) => a.kind === "vitest" || a.kind === "node:test");
  }
  const vitestArgs = vitestCall(prog, words);
  if (vitestArgs) return [vitestRun(vitestArgs)];
  const node = prog === "node" ? parseArgs(words.slice(1), NODE_VALUE_FLAGS) : null;
  if (node?.flags.some((f) => f.name === "--test" && f.at === 0)) return [nodeTestRun(node)];
  if (prog === "sleep" && /^\d/.test(words[1] ?? ""))
    return [{ kind: "sleep", seconds: Number.parseFloat(words[1]) }];
  return [];
}

/**
 * `squeal retry <file>... --reason load|environment` or `--cancel <file>...` (spec 001 D6, row
 * 006-53): `{ paths, reason, cancel }`, the paths as written, `reason` `null` when not given.
 */
function retryArgs(args) {
  const { flags, positional } = parseArgs(args, new Set(["--reason"]));
  return {
    paths: positional,
    reason: values(flags, "--reason").at(-1) ?? null,
    cancel: flags.some((f) => f.name === "--cancel"),
  };
}

/** The a9 and a10 knob's rates service (evals/atomic/retry/), as its script names it. */
const SERVICE = /(?:^|\/)rates-service\.mjs$/;

/**
 * Whether `words` starts the rates service: `node scripts/rates-service.mjs`, the script the
 * first operand after `node` and its flags, behind `nohup`, `setsid` or `env` (row 006-53).
 */
function serviceStart(words) {
  const i = words.findIndex((w) => base(w) === "node");
  if (
    i < 0 ||
    !words.slice(0, i).every((w) => /^(?:nohup|setsid|env)$/.test(base(w)) || /=/.test(w))
  )
    return false;
  const script = words.slice(i + 1).find((w) => !w.startsWith("-"));
  return script !== undefined && SERVICE.test(script) && !words.includes("--serve");
}

/** The package script `words` runs, `{ name, args }`: `npm test`, `npm run x`, `yarn x`. */
function scriptCall(prog, words) {
  if (!["npm", "pnpm", "yarn"].includes(prog)) return null;
  let at = 1;
  if (/^(?:run|run-script)$/.test(words[1] ?? "")) at = 2;
  else if (!/^(?:test|t)$/.test(words[1] ?? "") && (prog === "npm" || !(words[1] in SCRIPTS)))
    return null;
  const name = words[at] === "t" ? "test" : words[at];
  if (name === undefined) return null;
  const args = words.slice(at + 1);
  if (args[0] === "--") args.shift();
  return { name, args };
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
  return null;
}

/**
 * `args` as `{ flags, positional }`: each flag `{ name, value, at }`, `at` the number of
 * positionals before it, a flag in `valueFlags` taking the next word as its value; `--` ends
 * the flags.
 */
function parseArgs(args, valueFlags) {
  const flags = [];
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith("-") || a === "-") {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    const value = eq > 0 ? a.slice(eq + 1) : valueFlags.has(name) ? args[++i] : undefined;
    flags.push({ name, value, at: positional.length });
  }
  return { flags, positional };
}

const values = (flags, ...names) =>
  flags.filter((f) => names.includes(f.name) && f.value !== undefined).map((f) => f.value);

/**
 * A test action, its scope with the filters that narrow it (review wave 2.6, B3): `names` for a
 * test-name filter, `exclude` for excluded paths, `skip` for node:test's skip pattern, `only` for
 * `--test-only`, `projects` and `shard` for Vitest's. Only those given are set.
 */
function testRun(runner, informational, scope, filters) {
  const narrowed = { ...scope };
  for (const [key, value] of Object.entries(filters))
    if (Array.isArray(value) ? value.length : value) narrowed[key] = value;
  return { kind: runner, runner, informational, scope: narrowed };
}

function vitestRun(args) {
  const { flags, positional } = parseArgs(args, VITEST_VALUE_FLAGS);
  const sub = VITEST_SUBCOMMANDS.has(positional[0]) ? positional.shift() : "run";
  const has = (...names) => flags.some((f) => names.includes(f.name) && f.value !== "false");
  const informational = VITEST_NO_RUN.has(sub) || has(...HELP, "--watch", "-w", "--standalone");
  const scope =
    sub === "related"
      ? { full: false, paths: [], related: positional }
      : has("--changed")
        ? { full: false, paths: positional, changed: true }
        : positional.length
          ? { full: false, paths: positional }
          : { full: true };
  return testRun("vitest", informational, scope, {
    names: values(flags, "-t", "--testNamePattern"),
    exclude: values(flags, "--exclude"),
    projects: values(flags, "--project"),
    shard: values(flags, "--shard").at(-1),
  });
}

function nodeTestRun({ flags, positional }) {
  const informational = flags.some((f) => HELP.has(f.name) || f.name === "--watch");
  const scope = positional.length ? { full: false, paths: positional } : { full: true };
  return testRun("node:test", informational, scope, {
    names: values(flags, "--test-name-pattern"),
    skip: values(flags, "--test-skip-pattern"),
    only: flags.some((f) => f.name === "--test-only" && f.value !== "false") || undefined,
  });
}

/**
 * A scope's name in the grade's earlier counters: `name` with a name or skip filter, `full` for
 * the whole suite with nothing excluded, else `files`. Kept for `vitestByScope` until the
 * timeline keeps the scope itself (wave 2.6).
 */
export function scopeLabel(scope) {
  if (scope.names?.length || scope.skip?.length || scope.only) return "name";
  return scope.full && !scope.exclude?.length && !scope.projects?.length && !scope.shard
    ? "full"
    : "files";
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
