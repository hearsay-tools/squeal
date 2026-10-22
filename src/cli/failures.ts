import { failurePaths } from "../core/status/failures.js";
import {
  CLI_READ_RETRY_MS,
  FAILURES_LIMIT,
  formatFailures,
  readFailures,
} from "../core/status/index.js";
import type { EpochMs } from "../core/types/index.js";
import type { CliIo } from "./main.js";

const USAGE =
  "usage: squeal failures [<test file or directory>...] [--check <text>]... [--error <text>]...\n" +
  "                       [--per-check] [--limit <n>|all] [--all-worktrees] [--since <duration>]\n" +
  "                       [--json]\n";

/** The options that take a value, as `--name <value>` or `--name=<value>`. */
const VALUE_OPTIONS = ["--since", "--check", "--error", "--limit"] as const;

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * `squeal failures` (task 001-409): stored failing results, newest first,
 * from the shared store; starts no daemon. Exit 0 with an answer, 1 when
 * the store cannot answer, 2 on a usage error. Failures listed do not
 * change the exit code, as `status`. Row 011-75 (spec 011 C6 as amended for
 * 011-64): test files or directories, `--check` and `--limit` select. Review
 * 0.1.262 B1: `--error`, `--per-check` and `--limit all`, so the one command a
 * grouped notice prints lists each check of its group.
 */
export function failuresCommand(args: readonly string[], io: CliIo): number {
  let json = false;
  let allWorktrees = false;
  let sinceText: string | null = null;
  let limitText: string | null = null;
  let perCheck = false;
  const checks: string[] = [];
  const errors: string[] = [];
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const option = VALUE_OPTIONS.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (option !== undefined) {
      const value = arg === option ? (args[++i] ?? "") : arg.slice(option.length + 1);
      if (option === "--since") sinceText = value;
      else if (option === "--limit") limitText = value;
      else if (option === "--error") errors.push(value);
      else checks.push(value);
    } else if (arg === "--json") json = true;
    else if (arg === "--per-check") perCheck = true;
    else if (arg === "--all-worktrees") allWorktrees = true;
    else if (arg.startsWith("-")) return usage(`unexpected argument "${arg}"`, io);
    else paths.push(arg);
  }
  const now = io.now ?? Date.now;
  const window = sinceText === null ? null : durationMs(sinceText);
  if (sinceText !== null && window === null) {
    return usage(`--since takes a duration such as 90s, 30m, 2h or 1d, not "${sinceText}"`, io);
  }
  const limit = limitText === null || limitText === "all" ? limitText : positiveInteger(limitText);
  if (limit === null && limitText !== null) {
    return usage(
      `--limit takes a positive whole number such as 50, or all, not "${limitText}"`,
      io,
    );
  }
  if (checks.includes("")) return usage("--check takes a part of a check name", io);
  if (errors.includes("")) return usage("--error takes a part of an error", io);
  const cwd = io.cwd ?? process.cwd();
  const selected = failurePaths(cwd, paths);
  if ("outside" in selected) {
    return usage(`"${selected.outside}" is outside the worktree ${selected.root}`, io);
  }
  const since: EpochMs | null = window === null ? null : now() - window;
  const report = readFailures(cwd, {
    allWorktrees,
    since,
    paths: selected.paths,
    checks,
    errors,
    perCheck,
    limit: limit ?? FAILURES_LIMIT,
    busyRetryMs: CLI_READ_RETRY_MS,
  });
  io.stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatFailures(report));
  return report.available ? 0 : 1;
}

/** `90s`, `30m`, `2h`, `1d` in milliseconds; `null` for anything else. */
export function durationMs(text: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(text.trim());
  const unit = match?.[2] === undefined ? undefined : UNIT_MS[match[2]];
  return match === null || unit === undefined ? null : Number(match[1]) * unit;
}

/** A whole number of at least 1; `null` for anything else. */
function positiveInteger(text: string): number | null {
  const n = Number(text);
  return /^\d+$/.test(text) && n >= 1 && Number.isSafeInteger(n) ? n : null;
}

function usage(problem: string, io: CliIo): number {
  io.stderr(`squeal failures: ${problem}\n${USAGE}`);
  return 2;
}
