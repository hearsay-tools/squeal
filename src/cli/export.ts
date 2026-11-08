import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { squealVersion } from "../core/daemon/version.js";
import { readHead } from "../core/daemon-loop/head.js";
import { worktreeIdFor } from "../core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../core/keys/key-format.js";
import type { ExportHeader, ExportSource } from "../core/store/imports.js";
import { AbsolutePathError, type ExportCounts, exportResults } from "../core/store/transfer.js";
import { encodeBundle } from "../core/store/transfer-bundle.js";
import { worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { openForWrites } from "./store-writes.js";

const USAGE = "usage: squeal export [--out <file>]\n";

/**
 * `squeal export [--out <file>]` (spec 018 D2): writes this worktree's
 * passing results at its keys to one gzipped file, by default
 * `squeal-results-<commit8>.json.gz` in the working directory, and prints
 * what it wrote and left out. Reads the store only and needs no daemon, but
 * the keys a daemon computed. Exit 0 when it wrote the file, 1 when there was
 * nothing to write or a path was not relative, 2 on a usage error.
 */
export async function exportCommand(args: readonly string[], io: CliIo): Promise<number> {
  const out = parseOut(args);
  if (out !== null && typeof out === "object") {
    io.stderr(`squeal export: ${out.error}\n${USAGE}`);
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const store = openForWrites(root);
  if (store === null) {
    io.stderr(`squeal export: no Squeal store for ${root}; start a daemon with squeal start\n`);
    return 1;
  }
  const head = await readHead(root);
  const header: ExportHeader = {
    squealVersion: squealVersion(),
    keyFormat: KEY_FORMAT_VERSION,
    commit: head.head,
    dirty: head.dirty,
    createdAt: (io.now ?? Date.now)(),
    source: sourceOf(io.env ?? process.env),
  };
  try {
    const { bundle, counts } = exportResults(store, worktreeIdFor(root), header);
    if (counts.testFiles === 0) {
      io.stderr(`squeal export: ${nothingText(counts)}; wrote nothing\n`);
      return 1;
    }
    const commit8 = header.commit === null ? "unborn" : header.commit.slice(0, 8);
    const file = resolve(io.cwd ?? process.cwd(), out ?? `squeal-results-${commit8}.json.gz`);
    writeFileSync(file, encodeBundle(bundle));
    io.stdout(`${countsText(counts, file)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof AbsolutePathError)) throw error;
    io.stderr(`${error.message}; wrote nothing\n`);
    return 1;
  } finally {
    store.close();
  }
}

function parseOut(args: readonly string[]): string | null | { readonly error: string } {
  let out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--out") {
      const value = args[++i];
      if (value === undefined || value === "") return { error: "--out names no file" };
      out = value;
    } else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else return { error: `unknown argument "${arg}"` };
  }
  return out;
}

/**
 * Spec 018 D2: the source where the environment names one (GitHub Actions'
 * variables), otherwise `local`. Recorded, never inferred later.
 */
export function sourceOf(env: Readonly<Record<string, string | undefined>>): ExportSource {
  const named = (name: string) => {
    const value = env[name];
    return value === undefined || value === "" ? null : value;
  };
  if (named("GITHUB_RUN_ID") === null && named("GITHUB_REPOSITORY") === null) {
    return { kind: "local" };
  }
  return {
    kind: "github",
    repository: named("GITHUB_REPOSITORY"),
    runId: named("GITHUB_RUN_ID"),
    ref: named("GITHUB_REF"),
    event: named("GITHUB_EVENT_NAME"),
    sha: named("GITHUB_SHA"),
  };
}

const files = (n: number) => `${n} test file${n === 1 ? "" : "s"}`;

function nothingText(counts: ExportCounts): string {
  if (counts.keyed === 0) {
    return "no test file of this worktree has a key yet: the daemon computes keys (squeal start)";
  }
  return `none of the ${files(counts.keyed)} with a key has only passes and skips stored at it`;
}

/** What the export wrote, and the files left out by reason. */
export function countsText(counts: ExportCounts, file: string): string {
  const results = `${counts.results} result${counts.results === 1 ? "" : "s"}`;
  const left = [
    counts.noKey > 0 ? `${files(counts.noKey)} with no current key` : null,
    counts.noResult > 0 ? `${files(counts.noResult)} with no result at the key` : null,
    counts.failed > 0 ? `${files(counts.failed)} with a failure at the key` : null,
  ].filter((part) => part !== null);
  const leftText = left.length === 0 ? "" : `\nLeft out: ${left.join(", ")}.`;
  return `Exported ${files(counts.testFiles)}, ${results}, to ${file}.${leftText}`;
}
