import { formatFailures, readFailures } from "../core/status/index.js";
import type { EpochMs } from "../core/types/index.js";
import type { CliIo } from "./main.js";

const USAGE = "usage: squeal failures [--all-worktrees] [--since <duration>] [--json]\n";

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
 * change the exit code, as `status`.
 */
export function failuresCommand(args: readonly string[], io: CliIo): number {
  let json = false;
  let allWorktrees = false;
  let sinceText: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--json") json = true;
    else if (arg === "--all-worktrees") allWorktrees = true;
    else if (arg === "--since") {
      sinceText = args[i + 1] ?? "";
      i++;
    } else if (arg.startsWith("--since=")) sinceText = arg.slice("--since=".length);
    else return usage(`unexpected argument "${arg}"`, io);
  }
  const now = io.now ?? Date.now;
  const window = sinceText === null ? null : durationMs(sinceText);
  if (sinceText !== null && window === null) {
    return usage(`--since takes a duration such as 90s, 30m, 2h or 1d, not "${sinceText}"`, io);
  }
  const since: EpochMs | null = window === null ? null : now() - window;
  const report = readFailures(io.cwd ?? process.cwd(), { allWorktrees, since });
  io.stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatFailures(report));
  return report.available ? 0 : 1;
}

/** `90s`, `30m`, `2h`, `1d` in milliseconds; `null` for anything else. */
export function durationMs(text: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(text.trim());
  const unit = match?.[2] === undefined ? undefined : UNIT_MS[match[2]];
  return match === null || unit === undefined ? null : Number(match[1]) * unit;
}

function usage(problem: string, io: CliIo): number {
  io.stderr(`squeal failures: ${problem}\n${USAGE}`);
  return 2;
}
