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
import { formatReach } from "./reach-format.js";
import { statusCommand } from "./status-command.js";

/*
 * Spec 015 D11: `squeal reach [<path>...] [--limit <n>] [--json]`, the
 * on-demand edit-reach report. Pull only: it reads the stores, needs no
 * daemon, runs no test and writes nothing. Exit 0 with an answer, the
 * proposal included; 1 when there is no store; 2 on a usage error, as in
 * `squeal code`.
 */

export const REACH_USAGE = "squeal reach [<path>...] [--limit <n>] [--json]";

/** Entries per part in the text, D11's default. */
export const REACH_LIMIT = 10;

type Parsed = { readonly json: boolean; readonly limit: number | null; readonly paths: string[] };

function parseArgs(args: readonly string[]): Parsed | { readonly error: string } {
  let json = false;
  let limit: number | null = null;
  const paths: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const arg = args[at] as string;
    if (arg === "--json") json = true;
    else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const value = arg === "--limit" ? args[++at] : arg.slice("--limit=".length);
      const n = Number(value);
      if (value === undefined || !Number.isInteger(n) || n < 1) {
        return {
          error: `--limit takes a whole number of entries, 1 or more, not "${value ?? ""}"`,
        };
      }
      limit = n;
    } else if (arg.startsWith("--")) return { error: `unknown option "${arg}"` };
    else paths.push(arg);
  }
  return { json, limit, paths };
}

/** `squeal reach`. Async only to compile the lexer, which reads barrels. */
export async function reachCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    io.stderr(`squeal reach: ${parsed.error}\n\nUsage: ${REACH_USAGE}\n`);
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
      return buildReport(snapshot, { paths: named, limit, command, listed });
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
  io.stdout(parsed.json ? `${JSON.stringify(read, null, 2)}\n` : formatReach(read));
  return 0;
}
