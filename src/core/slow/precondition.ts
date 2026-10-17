import { spawn } from "node:child_process";
import { type Dirent, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lowerProcess } from "../daemon/low-priority.js";
import { PRECONDITION_TIMEOUT_MS } from "../daemon/policy-precondition.js";
import { createInputMatcher, globToRegExp } from "../keys/glob.js";
import type {
  AbsolutePath,
  Policy,
  RelativePath,
  SlowPrecondition,
  TestFileRef,
} from "../types/index.js";

/*
 * Spec 004 D7 and D8 as amended 2026-10-17 (task 004-65, issues #3 and #16):
 * what a slow tier needs on disk before it runs. Squeal checks it when a slow
 * tier is about to take the slot and never builds, installs or repairs
 * anything to meet it; an unmet one skips the tier with one reason.
 */

/** A precondition and the key that declared it, as a skip's reason names it. */
export interface PreconditionRule {
  readonly precondition: SlowPrecondition;
  /** `slow.precondition`, or `nodeTest "<name>" precondition` for a project's own. */
  readonly source: string;
}

/**
 * The precondition `ref`'s slow tier must meet: its node:test project's own,
 * which replaces `slow.precondition` for that project's files, else
 * `slow.precondition`; `null` with none declared.
 */
export function preconditionFor(policy: Policy, ref: TestFileRef): PreconditionRule | null {
  const project = policy.nodeTest.find((p) => p.name === ref.project);
  if (project?.precondition !== undefined) {
    return {
      precondition: project.precondition,
      source: `nodeTest ${JSON.stringify(project.name)} precondition`,
    };
  }
  const own = policy.slow.precondition;
  return own === undefined ? null : { precondition: own, source: "slow.precondition" };
}

/**
 * Whether a revision changing `paths` may have changed what `rule` reads, so
 * its skipped files are eligible again (D8): always for a command, which may
 * read anything, else when a path is one an `exists` glob selects.
 */
export function touchesPrecondition(
  rule: PreconditionRule,
  paths: Iterable<RelativePath>,
): boolean {
  const { exists, command } = rule.precondition;
  if (command !== undefined) return true;
  const matches = createInputMatcher(exists ?? []);
  for (const path of paths) if (matches(path)) return true;
  return false;
}

export interface CheckOptions {
  /** Ends a command still running: the tier is closing. */
  readonly signal?: AbortSignal;
}

/**
 * `null` when `rule` is met in the worktree at `root`, else the one reason
 * the tier is skipped (`dist/index.js matches no file (slow.precondition.exists)`).
 * Every `exists` entry is checked before the command, which runs only when
 * they all match. Never rejects.
 */
export async function checkPrecondition(
  root: AbsolutePath,
  rule: PreconditionRule,
  options: CheckOptions = {},
): Promise<string | null> {
  const { exists, command } = rule.precondition;
  const missing = (exists ?? []).find((glob) => !matchesAny(root, glob));
  if (missing !== undefined) return `${missing} matches no file (${rule.source}.exists)`;
  if (command === undefined) return null;
  const timeoutMs = rule.precondition.timeoutMs ?? PRECONDITION_TIMEOUT_MS;
  const failed = await runCommand(root, command, timeoutMs, options.signal);
  return failed === null ? null : `${argvText(command)} ${failed} (${rule.source}.command)`;
}

const GLOB_CHARS = /[*?[{]/;

/** Directories a glob walk enters only when the glob names them. */
const UNWALKED: ReadonlySet<string> = new Set([".git", "node_modules"]);

/**
 * A literal path matches when it exists; a glob when a file below its
 * literal prefix matches it, found by a walk that stops at the first.
 */
function matchesAny(root: AbsolutePath, glob: string): boolean {
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  const segments = source.split("/");
  const at = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  if (at === -1) return existsSync(join(root, source));
  const pattern = globToRegExp(source);
  const named = new Set(segments.filter((segment) => UNWALKED.has(segment)));
  const found = (dir: string): boolean => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (UNWALKED.has(entry.name) && !named.has(entry.name)) continue;
        if (found(path)) return true;
      } else if (pattern.test(path)) return true;
    }
    return false;
  };
  return found(segments.slice(0, at).join("/"));
}

/**
 * Runs `argv` without a shell in `root` at the slow tier's `nice` (D2);
 * `null` on exit 0, else what happened, as the reason's verb phrase.
 */
function runCommand(
  root: AbsolutePath,
  argv: readonly string[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const [program, ...args] = argv as [string, ...string[]];
  return new Promise((resolve) => {
    let settled = false;
    const end = (outcome: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(outcome);
    };
    const child = spawn(program, args, { cwd: root, stdio: "ignore", shell: false });
    if (child.pid !== undefined) lowerProcess(child.pid);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      end(`did not exit within ${timeoutMs} ms`);
    }, timeoutMs);
    timer.unref();
    const abort = () => {
      child.kill("SIGKILL");
      end("was stopped as the daemon closed");
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => end(`could not start: ${error.message}`));
    child.on("exit", (code, killed) => {
      if (code === 0) end(null);
      else end(code === null ? `was killed by ${killed}` : `exited ${code}`);
    });
  });
}

/** `node scripts/check-dist.mjs`, an argument with a space or a quote quoted. */
export function argvText(argv: readonly string[]): string {
  return argv.map((arg) => (/^[\w./:=@%+,-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" ");
}
