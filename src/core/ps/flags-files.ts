import { join } from "node:path";
import { SLOT_WAITER_FRESH_MS } from "../slow/index.js";
import { lockFileWorktreeId, storePaths } from "../store/paths.js";
import { shellWord } from "../text.js";
import type { AbsolutePath } from "../types/index.js";
import type { PsModel, PsPlaces } from "./model.js";
import { lstatOrNull, names, poolDirs } from "./reads.js";
import { dateOf } from "./render-units.js";
import type { PsFileFlag, PsUnflaggedFiles, PsUnflaggedKind, PsUnknown } from "./shape.js";

/*
 * Spec 014 D7, the files (task 014-10): a socket no live daemon of its id
 * holds, and a pool mark past its freshness. Each is read by `readdir` and
 * `lstat` alone; nothing here removes a file. The files whose lock the OS
 * frees when the holder dies never get a flag; they are counted by kind.
 */

const WAITER_LOCK = /^waiter-.+\.sqlite$/;
const PERMIT = /^pool\.(\d+)\.lock$/;
const MARK = /^pool\.mark\.[^.]+$/;

export interface FileFindings {
  readonly files: readonly PsFileFlag[];
  readonly unflagged: readonly PsUnflaggedFiles[];
  readonly unknown: readonly PsUnknown[];
}

export function fileFlags(model: PsModel): FileFindings {
  const unknown: PsUnknown[] = [];
  return {
    files: [...staleSockets(model, unknown), ...stalePoolMarks(model)],
    unflagged: unflagged(model),
    unknown,
  };
}

/** `squeal-<id>.sock` with no live daemon of `<id>` (D2 step 4 ties them), and no listener. */
function staleSockets(model: PsModel, unknown: PsUnknown[]): PsFileFlag[] {
  const flags: PsFileFlag[] = [];
  for (const socket of model.discovery.sockets) {
    if (socket.daemonPid !== null) continue;
    if (socket.listening === true) {
      const why = `a process listens at it, but no daemon of worktree ${socket.worktreeId} was found`;
      unknown.push({ what: `socket ${socket.path}`, why });
      continue;
    }
    flags.push({
      flag: "stale-socket",
      reason: `no live daemon of worktree ${socket.worktreeId} holds its lock; changed ${dateOf(socket.mtimeMs)}`,
      path: socket.path,
      count: 1,
      bytes: 0,
      command: `rm ${shellWord(socket.path)}`,
    });
  }
  return flags;
}

/** A `pool.mark.*` file older than `SLOT_WAITER_FRESH_MS`: its holder died; readers skip it. */
function stalePoolMarks(model: PsModel): PsFileFlag[] {
  const flags: PsFileFlag[] = [];
  for (const dir of poolDirs(model.places)) {
    for (const name of names(dir)) {
      if (!MARK.test(name)) continue;
      const path = join(dir, name);
      const stat = lstatOrNull(path);
      if (stat === null || !stat.isFile() || model.now - stat.mtimeMs <= SLOT_WAITER_FRESH_MS)
        continue;
      flags.push({
        flag: "stale-pool-mark",
        reason: `unchanged since ${dateOf(stat.mtimeMs)}; readers skip a mark older than ${SLOT_WAITER_FRESH_MS / 1000} s`,
        path,
        count: 1,
        bytes: stat.size,
        command: `rm ${shellWord(path)}`,
      });
    }
  }
  return flags;
}

/**
 * D7's last paragraph, for `--full`: every worktree lock and waiter lock
 * file of the stores in view, every permit file above the pool's size, and
 * every session-root file. Only the kinds that have one are listed.
 */
function unflagged(model: PsModel): PsUnflaggedFiles[] {
  const counts = new Map<PsUnflaggedKind, number>();
  const count = (kind: PsUnflaggedKind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const commonDirs = new Set(
    [...model.discovery.daemons.map((d) => d.commonDir), model.places.commonDir].filter(
      (dir): dir is AbsolutePath => dir !== null,
    ),
  );
  for (const dir of commonDirs) {
    for (const name of names(storePaths(dir).locksDir)) {
      if (lockFileWorktreeId(name) !== null) count("lock");
      else if (WAITER_LOCK.test(name)) count("waiter-lock");
    }
  }
  for (const dir of poolDirs(model.places)) {
    for (const name of names(dir)) {
      const i = PERMIT.exec(name)?.[1];
      if (i !== undefined && Number(i) >= model.pool.pool.slots) count("surplus-permit");
    }
  }
  for (const dir of sessionDirs(model.places)) {
    for (const _ of names(dir)) count("session-root");
  }
  const kinds: readonly PsUnflaggedKind[] = [
    "lock",
    "waiter-lock",
    "surplus-permit",
    "session-root",
  ];
  return kinds.flatMap((kind) => {
    const n = counts.get(kind) ?? 0;
    return n === 0 ? [] : [{ kind, count: n }];
  });
}

/**
 * The session roots' directories: `squeal-sessions` in the runtime
 * directory and in the per-user `squeal-<uid>` of the temp one, as a
 * daemon's hooks pick one by their own environment.
 */
function sessionDirs(places: PsPlaces): AbsolutePath[] {
  const dirs = [join(places.tempDir, `squeal-${places.uid}`, "squeal-sessions")];
  if (places.runtimeDir !== null) dirs.push(join(places.runtimeDir, "squeal-sessions"));
  return dirs;
}
