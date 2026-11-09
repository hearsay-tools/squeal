import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Published, publishExport } from "../core/ci/publish.js";
import { readPolicy } from "../core/daemon/policy.js";
import { findWorktreeRoot } from "../core/fs/git-layout.js";
import { DEFAULT_SHARED_REF } from "../core/shared/refs.js";
import type { CliIo } from "./main.js";

export const PUBLISH_USAGE = "usage: squeal ci publish <export> [--keep <n>]\n";

/** Spec 018 D13: main commits whose refs stay by default (`transport.md` 2: about two days in cezar). */
export const DEFAULT_KEEP = 100;

/** The remote the export job's checkout pushes to. */
const REMOTE = "origin";

interface PublishArgs {
  readonly file: string;
  readonly keep: number;
}

/**
 * `squeal ci publish <export> [--keep <n>]` (spec 018 D13): in the export
 * job, which alone has `contents: write`, pushes the export as
 * `<shared.ref>/<sha>` (default `refs/squeal/<sha>`) to `origin`, and in the
 * same push deletes the refs of main commits beyond the newest `n` (default
 * 100). Exit 0 when the ref was written, 1 when it was not, 2 on a usage
 * error.
 */
export async function ciPublishCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parsePublish(args);
  if ("error" in parsed) {
    io.stderr(`squeal ci publish: ${parsed.error}\n${PUBLISH_USAGE}`);
    return 2;
  }
  const say = (text: string) => io.stderr(`squeal ci publish: ${text}\n`);
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    say(`${cwd} is not inside a git worktree; published nothing`);
    return 1;
  }
  const file = resolve(cwd, parsed.file);
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    say(`cannot read ${file}: ${(error as Error).message}; published nothing`);
    return 1;
  }
  const prefix = readPolicy(root).shared.ref ?? DEFAULT_SHARED_REF;
  const outcome = await publishExport({ root, bytes, keep: parsed.keep, remote: REMOTE, prefix });
  if ("refused" in outcome) {
    say(`${outcome.refused}; published nothing`);
    return 1;
  }
  io.stdout(`${publishedText(outcome, parsed.keep)}\n`);
  return 0;
}

function parsePublish(args: readonly string[]): PublishArgs | { readonly error: string } {
  let keep = DEFAULT_KEEP;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--keep" || arg.startsWith("--keep=")) {
      const value = arg === "--keep" ? args[++i] : arg.slice("--keep=".length);
      if (value === undefined || !/^[1-9]\d*$/.test(value)) {
        return { error: "--keep takes a whole number of main commits, at least 1" };
      }
      keep = Number(value);
    } else if (arg.startsWith("--")) return { error: `unknown option "${arg}"` };
    else files.push(arg);
  }
  if (files.length !== 1)
    return { error: files.length === 0 ? "names no export" : "takes one export" };
  return { file: files[0] as string, keep };
}

function publishedText(published: Published, keep: number): string {
  const n = published.deleted.length;
  const lines = [
    `Published ${published.ref}; deleted ${n} ref${n === 1 ? "" : "s"} beyond the newest ${keep} main commits.`,
  ];
  if (published.failed.length > 0) {
    lines.push(
      `${REMOTE} refused to delete ${published.failed.length}; the next publish tries again.`,
    );
  }
  if (published.unplaced > 0) {
    const why = published.shallow
      ? "this checkout is shallow; check out with fetch-depth: 0 to prune them"
      : "their commits are not on this commit's first-parent line";
    lines.push(
      `Kept ${published.unplaced} ref${published.unplaced === 1 ? "" : "s"} it cannot place: ${why}.`,
    );
  }
  return lines.join("\n");
}
