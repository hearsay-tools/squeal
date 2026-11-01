// What every cell shares, built once under the scratch root: the plugins of the commit under
// test (`git archive`, so a dirty checkout never leaks into a run) and the fixture's Vitest;
// then per cell, the run's identity and the arm's committed fixture.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EVALS = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = join(EVALS, "..");

/** The full hash of `ref` in this repository. */
export function resolveCommit(ref = "HEAD") {
  return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
}

/** `<root>/pin-base/<commit>`: the commit's plugins and marketplaces, extracted once. */
export function pinBase(root, commit) {
  const dir = join(root, "pin-base", commit);
  if (existsSync(join(dir, ".done"))) return dir;
  const partial = `${dir}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  const tar = execFileSync(
    "git",
    ["archive", commit, "plugins", ".agents/plugins", ".claude-plugin"],
    { cwd: REPO, maxBuffer: 1 << 30 },
  );
  execFileSync("tar", ["-x", "-C", partial], { input: tar });
  writeFileSync(join(partial, ".done"), `${commit}\n`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(partial, dir);
  return dir;
}

/** Squeal's version in a pin: the Claude Code plugin's manifest. */
export function pinVersion(pin) {
  return JSON.parse(
    readFileSync(join(pin, "plugins/claude-code/.claude-plugin/plugin.json"), "utf8"),
  ).version;
}

const CLI = "dist/cli/squeal.mjs";

/** A pin with no Squeal CLI for a harness (row 006-100): its cell stops before any session. */
export class MissingPinCli extends Error {
  constructor(pin, harness, why) {
    super(`missing pinned Squeal CLI for ${harness}: ${why} (pin ${pin})`);
    this.name = "MissingPinCli";
  }
}

const versionIn = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")).version;
  } catch {
    return undefined;
  }
};

/**
 * The Squeal a cell of `harness` runs from `pin` (row 006-100): `{ cli, runtime }`. Claude Code,
 * and Codex before `e34c9bc1f` (0.1.368), run the plugin's own `dist/cli/squeal.mjs`, `runtime`
 * `null`. Since then the Codex plugin is a fixed adapter, `hooks/hooks.json` beside a `seed/`
 * (spec 002 D7, the launcher's test), whose seed stays the 0.1.368 build; the commit's runtime
 * is `plugins/codex-runtime`, `runtime` `{ root, version }`, which `install.sh` provisions and
 * a fresh session then selects over the older seed (D8, D9). Throws `MissingPinCli` when the CLI
 * is not there, or the runtime is not whole as the launcher reads one: a plain version that
 * `runtime.json` and `.codex-plugin/plugin.json` both name.
 */
export function pinSqueal(pin, harness) {
  const need = (cli) => {
    if (!existsSync(cli)) throw new MissingPinCli(pin, harness, `${cli} does not exist`);
    return cli;
  };
  if (harness !== "codex")
    return { cli: need(join(pin, "plugins/claude-code", CLI)), runtime: null };
  const plugin = join(pin, "plugins/codex");
  if (!existsSync(join(plugin, "hooks/hooks.json")) || !existsSync(join(plugin, "seed")))
    return { cli: need(join(plugin, CLI)), runtime: null };
  const root = join(pin, "plugins/codex-runtime");
  const cli = need(join(root, CLI));
  const version = versionIn(join(root, "runtime.json"));
  const named = versionIn(join(root, ".codex-plugin/plugin.json"));
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version) || version !== named)
    throw new MissingPinCli(
      pin,
      harness,
      `${root} is no whole runtime: runtime.json names ${version}, .codex-plugin/plugin.json ${named}`,
    );
  return { cli, runtime: { root, version } };
}

/** Codex's `PLUGIN_DATA` for squeal@hearsay under a cell's `codexHome`. */
const codexData = (codexHome) => join(codexHome, "plugins/data/squeal-hearsay");

/** `text` as `path`, whole: written beside it, then renamed over it. */
const writeWhole = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.${process.pid}.tmp`, text);
  renameSync(`${path}.${process.pid}.tmp`, path);
};

/**
 * The pin's Codex `runtime` (from `pinSqueal`) retained in the cell's `codexHome` as `install.sh`
 * leaves a fresh install (spec 002 D8): `plugins/data/squeal-hearsay/versions/<version>` and
 * `runtime/current.json` naming it, so the adapter's hooks and the launcher select it, with its
 * updates held (`holdCodexUpdates`). Returns the retained CLI, the one they run.
 */
export function retainCodexRuntime(codexHome, runtime) {
  const data = codexData(codexHome);
  const root = join(data, "versions", runtime.version);
  cpSync(runtime.root, root, { recursive: true });
  writeWhole(
    join(data, "runtime/current.json"),
    `${JSON.stringify({ schema: 1, version: runtime.version })}\n`,
  );
  holdCodexUpdates(codexHome, runtime.version);
  return join(root, CLI);
}

/** The next scheduled check's delay: a state over the updater's 60 minutes ahead is due (`isDue`). */
export const UPDATE_HOLD_MS = 59 * 60_000;

/**
 * Holds the cell's runtime updates off from `now` (review 006-100 B1; spec 002 D8):
 * `runtime/update.json` as a check that found `version` current, the next `UPDATE_HOLD_MS` later.
 * SessionStart schedules no update and a background updater answers not-due, so no download
 * selects another runtime for a resumed turn, whose pin SessionEnd removed. Renewed before each
 * turn, which ends at its timeout. An explicit `squeal update` ignores it: `checkCodexRuntime`.
 */
export function holdCodexUpdates(codexHome, version, now = Date.now()) {
  const at = new Date(now).toISOString();
  const state = {
    schema: 1,
    checkedAt: at,
    nextCheckAt: new Date(now + UPDATE_HOLD_MS).toISOString(),
    outcome: "current",
    release: `squeal--v${version}`,
    selected: version,
    failure: null,
    lastSuccessAt: at,
  };
  writeWhole(
    join(codexData(codexHome), "runtime/update.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/** A Codex cell that ran another runtime than its pin's (review 006-100 B1): it keeps no grade. */
export class RuntimeMoved extends Error {
  constructor(version, why) {
    super(`the cell's Codex runtime moved off ${version}: ${why}`);
    this.name = "RuntimeMoved";
  }
}

/**
 * Throws `RuntimeMoved` unless the cell kept one runtime, `version`: `runtime/current.json` still
 * names it and `versions/` holds no other version, so no hook of any turn could select another.
 */
export function checkCodexRuntime(codexHome, version) {
  const data = codexData(codexHome);
  const current = versionIn(join(data, "runtime/current.json"));
  const others = readdirSync(join(data, "versions")).filter(
    (v) => /^\d+\.\d+\.\d+$/.test(v) && v !== version,
  );
  const why = [
    ...(current === version ? [] : [`runtime/current.json names ${current ?? "none"}`]),
    ...(others.length ? [`versions/ also holds ${others.join(", ")}`] : []),
  ];
  if (why.length) throw new RuntimeMoved(version, why.join("; "));
}

/** `<root>/nm/node_modules`: the fixture's devDependencies, installed once and copied into each cell. */
export function fixtureModules(root) {
  const dir = join(root, "nm");
  if (existsSync(join(dir, ".done"))) return join(dir, "node_modules");
  const pkg = JSON.parse(readFileSync(join(EVALS, "ledgerline/package.json"), "utf8"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ private: true, devDependencies: pkg.devDependencies }),
  );
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], {
    cwd: dir,
    stdio: "ignore",
  });
  writeFileSync(join(dir, ".done"), "");
  return join(dir, "node_modules");
}

/** A cell's id: task, variant, harness and model, effort, repetition. */
export function cellId({ task, variant, harness, model, effort, rep, cold = false }) {
  return `${task}.${variant}.${harness}-${model.replace(/[^\w.-]/g, "_")}.e-${effort}.r${rep}${cold ? ".cold" : ""}`;
}

/** A fresh run's identity: the start time to the second and 6 random hex digits. */
export function runId(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

const FIXED_DATE = "2026-10-01T09:00:00Z";

/**
 * The fixture at `work` for one arm, committed at a fixed date by a fixed author: `ledgerline`
 * with `BASE.md` as `CLAUDE.md` and `AGENTS.md`, the variant's instructions appended and its
 * policy merged into `squeal.config.json`, `modules` copied in as `node_modules` (ignored).
 * Returns the commit, the arm's fixture identity: equal for every cell of one arm.
 */
export function buildFixture({ work, variant, env, modules = null }) {
  cpSync(join(EVALS, "ledgerline"), work, { recursive: true });
  const base = readFileSync(join(work, "BASE.md"), "utf8");
  rmSync(join(work, "BASE.md"));
  const instructions = variant.instructions ? `${base}\n${variant.instructions}` : base;
  writeFileSync(join(work, "CLAUDE.md"), instructions);
  writeFileSync(join(work, "AGENTS.md"), instructions);
  if (variant.policy) {
    const p = JSON.parse(readFileSync(join(work, "squeal.config.json"), "utf8"));
    writeFileSync(
      join(work, "squeal.config.json"),
      `${JSON.stringify({ ...p, ...variant.policy }, null, 2)}\n`,
    );
  }
  if (modules)
    cpSync(modules, join(work, "node_modules"), {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
  const git = (args) =>
    execFileSync("git", args, {
      cwd: work,
      encoding: "utf8",
      env: {
        ...env,
        GIT_AUTHOR_NAME: "ledgerline",
        GIT_AUTHOR_EMAIL: "dev@ledgerline.invalid",
        GIT_COMMITTER_NAME: "ledgerline",
        GIT_COMMITTER_EMAIL: "dev@ledgerline.invalid",
        GIT_AUTHOR_DATE: FIXED_DATE,
        GIT_COMMITTER_DATE: FIXED_DATE,
      },
    });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "commit.gpgsign=false", "commit", "-qm", "ledgerline 1.4.0"]);
  return git(["rev-parse", "HEAD"]).trim();
}

const USAGE =
  "usage: run-cell.mjs <task> <variant> <claude|codex> <model> [rep] [--commit HEAD] [--run <id> [--resume]] [--effort medium] [--cold] [--dry] [--max-load <cpus>] [--timeout-s 900] [--grace-s 10]";

/**
 * run-cell.mjs's arguments: throws the usage, or why, on a bad one. `--resume` needs `--run`;
 * without `--run` the cell gets a fresh run id. Opus and Fable are never subjects (D5).
 */
export function cellArgs(argv, { runId: fresh = runId, maxLoad = 1 } = {}) {
  const rest = [...argv];
  const flag = (name, dflt) => {
    const i = rest.indexOf(name);
    return i < 0 ? dflt : rest.splice(i, 2)[1];
  };
  const has = (name) => {
    const i = rest.indexOf(name);
    if (i >= 0) rest.splice(i, 1);
    return i >= 0;
  };
  const out = {
    dry: has("--dry"),
    cold: has("--cold"),
    resume: has("--resume"),
    run: flag("--run", null),
    maxLoad: Number(flag("--max-load", String(maxLoad))),
    timeoutS: Number(flag("--timeout-s", "900")),
    graceS: Number(flag("--grace-s", "10")),
    effort: flag("--effort", "medium"),
    commit: flag("--commit", "HEAD"),
  };
  const [task, variant, harness, model, rep = "1"] = rest;
  if (!task || !variant || !["claude", "codex"].includes(harness) || !model) throw new Error(USAGE);
  if (out.resume && !out.run) throw new Error(`--resume needs --run <id>\n${USAGE}`);
  if (!/^(low|medium|high|xhigh|max)$/.test(out.effort))
    throw new Error(`--effort ${out.effort}: not a level both harnesses take`);
  if (/opus|fable/i.test(model))
    throw new Error("never Opus or Fable as a subject model (spec 006 D5)");
  return { ...out, run: out.run ?? fresh(), task, variant, harness, model, rep };
}
