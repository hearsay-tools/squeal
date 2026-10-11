// What every cell shares, built once under the scratch root: the plugins of the commit under
// test (`git archive`, so a dirty checkout never leaks into a run) and the fixture's Vitest;
// then per cell, the run's identity and the arm's committed fixture.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
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
