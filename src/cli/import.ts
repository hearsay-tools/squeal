import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { compareEnvironment, comparisonText } from "../core/status/import-environment.js";
import { worktreeEnvironment } from "../core/store/environments.js";
import { sourceLabel } from "../core/store/imports.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { type ImportCounts, importRefusal, importResults } from "../core/store/transfer.js";
import { decodeBundle, type ResultsBundle } from "../core/store/transfer-bundle.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { BUSY_BOUND_MS, isBusyAnswer, whileBusy } from "./store-writes.js";

const USAGE = "usage: squeal import <file> [--dry-run]\n";

/**
 * `squeal import <file> [--dry-run]` (spec 018 D3): adds an export's results
 * to this repository's shared store in one transaction, then tells the
 * running daemons, and prints what was added and, per project, whether the
 * export's environment equals this worktree's. Works before any daemon has
 * started: the store is made when missing. `--dry-run` writes nothing and
 * prints the same. Exit 0 when imported, 1 when the file was refused or the
 * store stayed busy, 2 on a usage error.
 */
export async function importCommand(args: readonly string[], io: CliIo): Promise<number> {
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
  const now = (io.now ?? Date.now)();
  const options = { importId: fileHash.slice(0, 16), fileHash, now, dryRun: parsed.dryRun };
  try {
    const counts = whileBusy(store, now + BUSY_BOUND_MS, () =>
      importResults(store, bundle, options),
    );
    if (isBusyAnswer(counts)) {
      io.stderr(
        `squeal import: store busy, waited ${counts.busyMs} ms: another process holds the store's lock; run the command again once it is released\n`,
      );
      return 1;
    }
    io.stdout(`${addedText(bundle, counts, parsed.dryRun)}\n`);
    io.stdout(`${environmentLines(store, bundle, worktreeIdFor(root))}\n`);
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
