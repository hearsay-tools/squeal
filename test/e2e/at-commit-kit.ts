import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { homedir, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/harness/build.js";

/*
 * Spec 023 Testing, end to end (row 023-09): the shipped bundle, as built, run
 * the way an agent runs it, on copies of real repositories. Every copy lives
 * under one throwaway folder in TMPDIR, with its own HOME; the real HOME is
 * only read (the pnpm store path, Corepack's cached pnpm and pnpm's lockfile
 * verification cache, both copied in) and the package store stays the normal
 * one, so a frozen install in a copy or in Squeal's checkout reuses it.
 * Squawk (`~/projects/cezar`) is only cloned from, never written.
 */

export const BUNDLE = join(REPO_ROOT, "plugins/claude-code/dist/cli/squeal.mjs");
const REAL_HOME = homedir();
export const SQUAWK = process.env.SQUEAL_E2E_SQUAWK ?? join(REAL_HOME, "projects", "cezar");
export const SQUAWK_PRESENT = existsSync(join(SQUAWK, ".git"));
export const SQUAWK_SKIP = `squawk cases skipped: ${SQUAWK} is absent`;
/** The suite runs only by hand (`SQUEAL_E2E_AT=1`, see tasks/023-09-notes.md): CI's full run and Squeal skip it. */
export const AT_E2E = process.env.SQUEAL_E2E_AT === "1";
const STORE =
  process.env.pnpm_config_store_dir ?? join(REAL_HOME, ".local", "share", "pnpm", "store");
/** Copied from the real HOME so neither Corepack nor pnpm's supply-chain check goes to the network again. */
const HOME_CACHES = [".cache/node/corepack", ".cache/pnpm/lockfile-verified.jsonl"];
const COMMAND_MS = 600_000;

export interface Bench {
  readonly root: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/*
 * Vitest's setup moves TMPDIR to `/tmp` (test/global-teardown.ts), which can be
 * another mount than the package store: a hardlinked clone and pnpm's store
 * links then fail, and Squeal puts its checkouts beside the repository. The
 * suite's command passes the shell's TMPDIR as SQUEAL_E2E_TMPDIR instead.
 */
const PARENT = process.env.SQUEAL_E2E_TMPDIR ?? tmpdir();

/** One throwaway folder per test file: copies, HOME, TMPDIR and a private runtime folder. */
export function bench(): Bench {
  const root = mkdtempSync(join(PARENT, "squeal-at-e2e-"));
  try {
    linkSync(join(REPO_ROOT, "package.json"), join(root, "link-probe"));
    rmSync(join(root, "link-probe"));
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(
      `${PARENT} cannot hold hardlinks to ${REPO_ROOT} (${String(error)}): set SQUEAL_E2E_TMPDIR to a folder on the package store's filesystem`,
    );
  }
  const home = join(root, "home");
  for (const dir of [home, join(root, "tmp"), join(root, "run")]) mkdirSync(dir, { mode: 0o700 });
  for (const path of HOME_CACHES) {
    const from = join(REAL_HOME, path);
    if (existsSync(from)) cpSync(from, join(home, path), { recursive: true });
  }
  // A clean environment: nothing of this session (CEZ_*, HSQ_*, SQUEAL_*, XDG_*, GITHUB_*) reaches a command.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: join(root, "tmp"),
    XDG_RUNTIME_DIR: join(root, "run"),
    LANG: "C.UTF-8",
    pnpm_config_store_dir: STORE,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
  };
  return { root, home, env };
}

export function git(b: Bench, cwd: string, args: readonly string[]): string {
  const id = [
    "-c",
    "user.name=squeal-e2e",
    "-c",
    "user.email=squeal-e2e@example.invalid",
    "-c",
    "gc.auto=0",
  ];
  return execFileSync("git", [...id, ...args], { cwd, env: b.env, encoding: "utf8" }).trim();
}

/**
 * `git clone --local`: hardlinked objects. A fixture commit writes new object
 * files and never rewrites a linked one, and `git` here runs with `gc.auto=0`,
 * so `--no-hardlinks` (8 GB for this repository) buys nothing. A shallow
 * source (squawk's) ignores `--local` with a warning and is copied in full.
 */
export function clone(b: Bench, source: string, name: string): string {
  const dir = join(b.root, name);
  execFileSync("git", ["clone", "-q", "--no-checkout", "--local", source, dir], {
    env: b.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  return dir;
}

/** Moves the copy to `commit` and installs its lockfile, as an agent's worktree would be. */
export function checkoutAt(b: Bench, dir: string, commit: string): void {
  git(b, dir, ["checkout", "-q", "--detach", commit]);
  execFileSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: dir,
    env: b.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

export function squeal(b: Bench, cwd: string, args: readonly string[]): Ran {
  const r = spawnSync(process.execPath, [BUNDLE, ...args], {
    cwd,
    env: b.env,
    encoding: "utf8",
    timeout: COMMAND_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The command's JSON report; a failure message carries its exit and stderr. */
export function report<T>(r: Ran): T {
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new Error(`no JSON report (exit ${r.code}):\n${r.stderr}\n${r.stdout}`);
  }
}

export interface ProofSide {
  readonly end: string;
  readonly from: string;
  readonly runs: number;
  readonly failures: readonly {
    readonly test: string;
    readonly kind: string;
    readonly text: string;
  }[];
}
export interface ProofFile {
  readonly path: string;
  readonly verdict: string;
  readonly reason: string | null;
  readonly red: ProofSide;
  readonly green: ProofSide;
}
export interface ProofReport {
  readonly case: string;
  readonly runs: number;
  readonly repeat: number;
  readonly files: readonly ProofFile[];
}

/** `squeal proof <args> --json` with one named test file: its exit, report and file row. */
export function proof(b: Bench, cwd: string, args: readonly string[]) {
  const r = squeal(b, cwd, ["proof", ...args, "--json"]);
  const parsed = report<ProofReport>(r);
  const file = parsed.files[0];
  if (file === undefined) throw new Error(`no file in the report:\n${r.stdout}`);
  return { code: r.code, report: parsed, file, text: `${r.stderr}\n${r.stdout}` };
}

/** The red side's failure of the named test, which must be an assertion. */
export function assertionOf(file: ProofFile, test: string): string {
  const failure = file.red.failures.find((f) => f.test === test);
  if (failure?.kind !== "assertion")
    throw new Error(`no assertion for ${test}: ${JSON.stringify(file.red)}`);
  return failure.text;
}

/** Runs one case, then prints its wall time and the one-minute load average at its start. */
export async function timed<T>(name: string, body: () => T | Promise<T>): Promise<T> {
  const load = loadavg()[0] ?? 0;
  const start = performance.now();
  try {
    return await body();
  } finally {
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    const line = `023-09 ${name}: ${seconds} s, load ${load.toFixed(2)} at start`;
    console.info(line);
    // Vitest hides a passing test's output; the suite's command names a file for these lines.
    if (process.env.SQUEAL_E2E_TIMINGS) appendFileSync(process.env.SQUEAL_E2E_TIMINGS, `${line}\n`);
  }
}

/** Processes whose command line or working folder lies under `root` (zombies aside). */
export function leftovers(root: string): string[] {
  const found: string[] = [];
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    if (Number(pid) === process.pid) continue;
    try {
      if (/^\S+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"))) continue;
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cmd.includes(root) || cwd.startsWith(root)) found.push(`${pid} ${cwd} ${cmd}`);
    } catch {
      // ended, or not ours to read
    }
  }
  return found;
}

/** Checkouts still under Squeal's checkout folder in this HOME (D6: a finished command leaves none). */
export function checkoutsLeft(b: Bench): string[] {
  const top = join(b.home, ".cache", "squeal", "checkouts");
  if (!existsSync(top)) return [];
  return readdirSync(top, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(top, d.name)).map((c) => join(d.name, c)));
}

/** Fails when a process or a checkout outlived the cases, then removes everything. */
export function sweep(b: Bench): void {
  const procs = leftovers(b.root);
  const checkouts = checkoutsLeft(b);
  for (const line of procs) {
    try {
      process.kill(Number(line.split(" ")[0]), "SIGKILL");
    } catch {
      // already gone
    }
  }
  rmSync(b.root, { recursive: true, force: true });
  if (procs.length > 0 || checkouts.length > 0)
    throw new Error(`left behind:\n${[...procs, ...checkouts].join("\n")}`);
}
