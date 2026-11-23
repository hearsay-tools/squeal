import { relative, resolve } from "node:path";
import type { CodeStore } from "../core/code/store/types.js";
import { codeSource, withCode } from "../core/delivery/code-source.js";
import { lexerReady } from "../core/reach/modules.js";
import { readSnapshot } from "../core/reach/read.js";
import { buildReport } from "../core/reach/report.js";
import type { ReachReport } from "../core/reach/report-types.js";
import { CLI_READ_RETRY_MS, withStatusStore } from "../core/status/open.js";
import type { RelativePath } from "../core/types/common.js";
import type { CliIo } from "./main.js";
import { formatImpact } from "./reach-format.js";
import { statusCommand } from "./status-command.js";

/*
 * Spec 015 D11: `squeal impact [<path>...] [--limit <n>] [--offset <n>] [--json]`, the
 * on-demand edit-impact report. Pull only: it reads the stores, needs no
 * daemon, runs no test and writes nothing. Exit 0 with an answer, the
 * proposal included; 1 when there is no store; 2 on a usage error, as in
 * `squeal code`. `squeal reach` is its hidden deprecated alias (amended
 * 2026-11-22, row 015-128). `--offset` pages the lists (row 015-129).
 */

export const IMPACT_USAGE = "squeal impact [<path>...] [--limit <n>] [--offset <n>] [--json]";

/** What the deprecated alias prints to stderr before a text answer; `--json` stays quiet. */
export const REACH_DEPRECATED =
  "squeal reach is deprecated: use squeal impact, which gives the same answer.\n";

/** Entries per part in the text, D11's default. */
export const REACH_LIMIT = 10;

type Parsed = {
  readonly json: boolean;
  readonly limit: number | null;
  readonly offset: number;
  readonly paths: string[];
};

/** A whole number of `least` or more, digits only: `Number("")` and `Number(" ")` read 0 (row 015-129). */
function count(value: string | undefined, least: number): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= least ? n : null;
}

const countError = (option: string, least: number, value: string | undefined) =>
  `${option} takes a whole number of entries, ${least} or more, not "${value ?? ""}"`;

function parseArgs(args: readonly string[]): Parsed | { readonly error: string } {
  let json = false;
  const counts: Record<string, number | null> = { "--limit": null, "--offset": 0 };
  const least: Record<string, number> = { "--limit": 1, "--offset": 0 };
  const paths: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const arg = args[at] as string;
    const option = Object.keys(least).find((o) => arg === o || arg.startsWith(`${o}=`));
    if (arg === "--json") json = true;
    else if (option !== undefined) {
      const value = arg === option ? args[++at] : arg.slice(option.length + 1);
      const n = count(value, least[option] as number);
      if (n === null) return { error: countError(option, least[option] as number, value) };
      counts[option] = n;
    } else if (arg.startsWith("--")) return { error: `unknown option "${arg}"` };
    else paths.push(arg);
  }
  return { json, limit: counts["--limit"] ?? null, offset: counts["--offset"] ?? 0, paths };
}

/** `squeal reach`, hidden and deprecated: `squeal impact`, with a notice on stderr unless `--json`. */
export function reachCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (!args.includes("--json")) io.stderr(REACH_DEPRECATED);
  return impactCommand(args, io);
}

/** `squeal impact`. Async only to compile the lexer, which reads barrels. */
export async function impactCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    io.stderr(`squeal impact: ${parsed.error}\n\nUsage: ${IMPACT_USAGE}\n`);
    return 2;
  }
  await lexerReady;
  const cwd = io.cwd ?? process.cwd();
  const command = statusCommand(io.env ?? process.env);
  // Text lists 10 per part by default; --json gives every entry unless --limit is given.
  const limit = parsed.limit ?? (parsed.json ? null : REACH_LIMIT);
  const read = withStatusStore(cwd, { busyRetryMs: CLI_READ_RETRY_MS }, (context) => {
    const { root } = context;
    const paths = parsed.paths.map((p) => relative(root, resolve(cwd, p)));
    const outside = paths.find((p) => p.startsWith(".."));
    if (outside !== undefined) return { message: `"${outside}" is outside the worktree ${root}` };
    const run = (code: CodeStore | null): ReachReport => {
      const { snapshot, listed } = readSnapshot({ store: context.store, root, code });
      const named: RelativePath[] | null = parsed.paths.length === 0 ? null : paths;
      return buildReport(snapshot, { paths: named, limit, offset: parsed.offset, command, listed });
    };
    const withCodeStore = withCode(codeSource(context.commonDir, root), ({ store }) =>
      store.read(() => run(store)),
    );
    return withCodeStore === null || withCodeStore === "missing" ? run(null) : withCodeStore;
  });
  if (!("v" in read)) {
    const answer = "available" in read ? read : { v: 1, available: false, message: read.message };
    io.stdout(parsed.json ? `${JSON.stringify(answer, null, 2)}\n` : `${read.message}\n`);
    return 1;
  }
  io.stdout(parsed.json ? `${JSON.stringify(read, null, 2)}\n` : formatImpact(read, command));
  return 0;
}
