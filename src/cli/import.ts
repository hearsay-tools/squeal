import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportCommitBlobs } from "../core/daemon/import-request.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { compareEnvironment, comparisonText } from "../core/status/import-environment.js";
import { isBusy } from "../core/store/connection.js";
import { worktreeEnvironment } from "../core/store/environments.js";
import { sourceLabel } from "../core/store/imports.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { decodeBundle, type ResultsBundle } from "../core/store/transfer-bundle.js";
import {
  type ImportCounts,
  type ImportOptions,
  importRefusal,
  importSliced,
  retriedSlice,
} from "../core/store/transfer-import.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";
import type { ImportOutcome } from "../core/types/daemon-writes.js";
import type { Store } from "../core/types/store.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS, worktreeRoot } from "./daemon-access.js";
import { importThroughDaemon } from "./import-daemon.js";
import type { CliIo } from "./main.js";
import { BUSY_BOUND_MS } from "./store-writes.js";

const USAGE = "usage: squeal import <file> [--dry-run]\n";

/** What a test sets in place of the command's defaults. */
export interface ImportInternal {
  /** How long one slice of an import made here asks a busy store. Default `BUSY_BOUND_MS`. */
  readonly busyBoundMs?: number;
}

/**
 * `squeal import <file> [--dry-run]` (spec 018 D3): adds an export's results
 * to this repository's shared store, then tells the running daemons, and
 * prints what was added and, per project, whether the export's environment
 * equals this worktree's. Spec 021 D15 (row 021-20): while a daemon serves
 * the worktree, it imports the file in its retried path; else the import is
 * made here, in slices that each ask a busy store again until the bound
 * (021 D1, D3). Works before any daemon has started: the store is made when
 * missing. `--dry-run` writes nothing and prints the same. Exit 0 when
 * imported, 1 when the file was refused or the store stayed busy, 2 on a
 * usage error.
 */
export async function importCommand(
  args: readonly string[],
  io: CliIo,
  internal: ImportInternal = {},
): Promise<number> {
  const parsed = parse(args);
  if (typeof parsed === "string") {
    io.stderr(`squeal import: ${parsed}\n${USAGE}`);
    return 2;
  }
  const file = resolve(io.cwd ?? process.cwd(), parsed.file);
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    io.stderr(`squeal import: cannot read ${file}: ${(error as Error).message}\n`);
    return 1;
  }
  const bundle = decodeBundle(bytes);
  const refusal = typeof bundle === "string" ? bundle : importRefusal(bundle);
  if (typeof bundle === "string" || refusal !== null) {
    io.stderr(`squeal import: refuses ${file}: ${refusal}\n`);
    return 1;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const store = openShared(root);
  if (typeof store === "string") {
    io.stderr(`squeal import: ${store}\n`);
    return 1;
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const worktreeId = worktreeIdFor(root);
  const clock = io.now ?? Date.now;
  const now = clock();
  try {
    const sent = { worktreeId, file, fileHash, dryRun: parsed.dryRun };
    const outcome =
      (await importThroughDaemon(store, sent, now)) ??
      (await importHere(store, bundle, root, worktreeId, {
        importId: fileHash.slice(0, 16),
        fileHash,
        now,
        clock,
        dryRun: parsed.dryRun,
        boundMs: internal.busyBoundMs ?? BUSY_BOUND_MS,
      }));
    if ("busyMs" in outcome) {
      io.stderr(
        `squeal import: store busy, waited ${outcome.busyMs} ms: another process holds the store's lock; run the command again once it is released\n`,
      );
      return 1;
    }
    if ("failed" in outcome) {
      io.stderr(`squeal import: ${outcome.failed}\n`);
      return 1;
    }
    io.stdout(`${addedText(bundle, outcome.counts, parsed.dryRun)}\n`);
    io.stdout(rekeyText(bundle, outcome.counts, outcome.commitHere));
    io.stdout(`${environmentLines(store, bundle, worktreeId)}\n`);
  } finally {
    store.close();
  }
  if (!parsed.dryRun) await tellDaemons(root);
  return 0;
}

function parse(args: readonly string[]): { file: string; dryRun: boolean } | string {
  let dryRun = false;
  const files: string[] = [];
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--")) return `unknown option "${arg}"`;
    else files.push(arg);
  }
  if (files.length !== 1) return files.length === 0 ? "names no file" : "takes one file";
  return { file: files[0] as string, dryRun };
}

/** The repository's shared store, made when missing; why not otherwise. */
function openShared(root: AbsolutePath): Store | string {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return `no git directory for ${root}`;
  const store = openStore(commonDir, { busyTimeoutMs: CLI_SOCKET_TIMEOUT_MS });
  return isStoreOpenFailure(store) ? `cannot open the Squeal store: ${store.reason}` : store;
}

function addedText(bundle: ResultsBundle, counts: ImportCounts, dryRun: boolean): string {
  const source = sourceLabel(bundle.header);
  const n = bundle.testFiles.length;
  const verb = dryRun ? "Dry run, nothing written: would import" : "Imported";
  const kept =
    counts.alreadyStored === 0
      ? ""
      : `; ${counts.alreadyStored} the store held at their keys already were left as they were`;
  const lists = [
    counts.closures > 0 ? `${counts.closures} closure lists` : null,
    counts.observed > 0 ? `${counts.observed} observed entries` : null,
    counts.startup > 0 ? `${counts.startup} start-up lists` : null,
  ].filter((part) => part !== null);
  const added = lists.length === 0 ? "" : `\nAdded where the store had none: ${lists.join(", ")}.`;
  return `${verb} ${counts.results} results of ${n} test file${n === 1 ? "" : "s"} from ${source}${kept}.${added}`;
}

/**
 * The import made here, with no daemon serving: in slices, each asked again
 * while another process holds the store's lock, until `boundMs` from its
 * first try (021 D1, D3); then how long that slice waited. What committed
 * before stays, and the import's record is written last, so the next
 * import adds the rest.
 */
async function importHere(
  store: Store,
  bundle: ResultsBundle,
  root: AbsolutePath,
  worktreeId: WorktreeId,
  options: Omit<ImportOptions, "rekeying"> & { readonly boundMs: number },
): Promise<ImportOutcome> {
  const blobs = await exportCommitBlobs(root, bundle.header.commit);
  const retried = retriedSlice(options.boundMs);
  let sliceFrom = Date.now();
  try {
    const counts = await importSliced(store, bundle, {
      ...options,
      rekeying: { worktreeId, blobs },
      run: (slice) => {
        sliceFrom = Date.now();
        return retried(slice);
      },
    });
    return { counts, commitHere: blobs !== null };
  } catch (error) {
    if (!isBusy(error)) throw error;
    return { busyMs: Date.now() - sliceFrom };
  }
}

/** How many files went at their key here (D11), or why none could: one line, or none. */
function rekeyText(bundle: ResultsBundle, counts: ImportCounts, commitHere: boolean): string {
  const at = bundle.header.commit?.slice(0, 8) ?? "an unborn commit";
  if (!commitHere) {
    return `Kept at the exported keys: this repository does not hold commit ${at}; fetch it and import again.\n`;
  }
  if (counts.rekeyed === 0) return "";
  const n = bundle.testFiles.length;
  return `Re-keyed ${counts.rekeyed} of ${n} test file${n === 1 ? "" : "s"} to this worktree's closure lists and environment at ${at}.\n`;
}

/** Per exported project, whether its environment equals this worktree's (D1), differences named. */
function environmentLines(store: Store, bundle: ResultsBundle, worktreeId: string): string {
  return bundle.environments
    .map((e) =>
      comparisonText(
        e.project,
        compareEnvironment(e, worktreeEnvironment(store, worktreeId, e.project)),
      ),
    )
    .join("\n");
}

/**
 * Tells each running daemon of the repository, as `squeal retry` tells its
 * worktree's: each reads the imported keys at its next reconciliation pass
 * or tier selection (011 C4 step 3), with no restart.
 */
async function tellDaemons(root: AbsolutePath): Promise<void> {
  const store = openShared(root);
  if (typeof store === "string") return;
  let sockets: AbsolutePath[];
  try {
    sockets = store.worktrees
      .list()
      .flatMap((w) => (w.daemon === null ? [] : [w.daemon.socketPath]));
  } finally {
    store.close();
  }
  await Promise.all(
    sockets.map((socket) => askDaemon(socket, { type: "retry" }).catch(() => null)),
  );
}
