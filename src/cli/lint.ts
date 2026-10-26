import { relative, resolve } from "node:path";
import { codeSince } from "../core/delivery/code-since.js";
import { worktreeIdFor } from "../core/fs/index.js";
import { lintChanged, lintDetails } from "../core/lint/surface/report.js";
import { lintStoreSource } from "../core/lint/surface/source.js";
import { CLI_READ_RETRY_MS, type StatusContext, withStatusStore } from "../core/status/index.js";
import type { RelativePath, StatusUnavailable } from "../core/types/index.js";
import type { LintChanged, LintDetails } from "../core/types/lint-delivery.js";
import { formatLintChanged, formatLintDetails } from "./lint-report.js";
import type { CliIo } from "./main.js";
import { waitConsumer } from "./status-wait.js";

/*
 * Spec 017 D8: `squeal lint [<path>...] [--changed] [--json]`, the details a
 * delivery and status only count, read from the lint store with no daemon.
 * Exit 0 with an answer, 1 when the stores cannot answer (lint off, the
 * lint store unreadable, status unavailable), 2 on a usage error.
 */

export const LINT_USAGE = "squeal lint [<path>...] [--changed] [--json]";

const OPTIONS = ["--json", "--changed"];

/** Why the lint store gave no answer, as a line. */
type NoAnswer = { readonly message: string };

/** What one `squeal lint` read: the details, or with `--changed` the changes. */
type Answer =
  | { readonly details: LintDetails; readonly paths: readonly RelativePath[] | null }
  | { readonly changed: LintChanged };

/** One read of the stores. */
function answer(
  { store, root, commonDir }: StatusContext,
  positional: readonly string[],
  changed: boolean,
  io: CliIo,
): Answer | NoAnswer {
  const cwd = io.cwd ?? process.cwd();
  const paths: RelativePath[] | null =
    positional.length === 0 ? null : positional.map((p) => relative(root, resolve(cwd, p)));
  const outside = paths?.find((p) => p.startsWith(".."));
  if (outside !== undefined) return { message: `"${outside}" is outside the worktree ${root}` };
  const source = lintStoreSource(commonDir, root);
  if (source.policy() === null) {
    return { message: "Lint is off: lint.enabled is false in squeal.config.json." };
  }
  const id = worktreeIdFor(root);
  if (changed) {
    const since = codeSince(store, id, waitConsumer(io.env ?? process.env));
    const read = lintChanged(source, id, since, paths ?? undefined);
    return read === undefined ? { message: "The lint store cannot be read." } : { changed: read };
  }
  const read = lintDetails(source, id, paths ?? undefined);
  return read === undefined
    ? { message: "The lint store cannot be read." }
    : { details: read, paths };
}

/** `squeal lint`. */
export function lintCommand(args: readonly string[], io: CliIo): number {
  const json = args.includes("--json");
  const changed = args.includes("--changed");
  const unknown = args.find((a) => a.startsWith("--") && !OPTIONS.includes(a));
  if (unknown !== undefined) {
    io.stderr(`squeal lint: unknown option "${unknown}"\n\nUsage: ${LINT_USAGE}\n`);
    return 2;
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const cwd = io.cwd ?? process.cwd();
  const read = withStatusStore(cwd, { busyRetryMs: CLI_READ_RETRY_MS }, (context) =>
    answer(context, positional, changed, io),
  );
  return print(read, json, io);
}

/** Prints the details or the changes, or why there are none. */
function print(read: Answer | NoAnswer | StatusUnavailable, json: boolean, io: CliIo): number {
  if ("details" in read) {
    const { v, ...details } = read.details;
    io.stdout(
      json
        ? `${JSON.stringify({ v, available: true, paths: read.paths, ...details }, null, 2)}\n`
        : formatLintDetails(read.details, read.paths),
    );
    return 0;
  }
  if ("changed" in read) {
    const { v, ...changed } = read.changed;
    io.stdout(
      json
        ? `${JSON.stringify({ v, available: true, ...changed }, null, 2)}\n`
        : formatLintChanged(read.changed),
    );
    return 0;
  }
  const answer = "available" in read ? read : { v: 1, available: false, message: read.message };
  io.stdout(json ? `${JSON.stringify(answer, null, 2)}\n` : `${read.message}\n`);
  return 1;
}
