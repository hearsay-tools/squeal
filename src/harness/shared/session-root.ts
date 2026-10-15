import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentUid, preparePrivateDir, runtimeDir } from "../../core/daemon/paths.js";
import { isRecord } from "../../core/fs/index.js";
import type { AbsolutePath } from "../../core/types/index.js";
import { type HookLocation, locate } from "./context.js";

/**
 * Where each session's root is kept between its hook processes (task
 * 001-405). Best effort: a store that cannot be read or written reads as
 * keeping nothing, and each hook then locates its own `cwd`.
 */
export interface SessionRoots {
  get(sessionId: string): HookLocation | null;
  set(sessionId: string, location: HookLocation): void;
  delete(sessionId: string): void;
}

/** The hook input fields that decide a session's root. */
export interface SessionRootInput {
  readonly session_id: string;
  readonly cwd: string;
  readonly agent_id?: string;
  readonly source?: string;
}

/** SessionStart sources that begin a new run, whose root is resolved again. */
const RESTART_SOURCES: ReadonlySet<string> = new Set(["startup", "resume"]);

/**
 * The root a hook of the session uses (task 001-405, the human's decision
 * of 2026-10-15): the one its SessionStart resolved, so a `cd` into another
 * worktree starts no daemon there and changes no header. A main agent's
 * SessionStart with source `startup`, `resume` or none resolves its `cwd`
 * again; `compact` and `clear` go on in the same run, whose `cwd` may have
 * moved. A session with no kept root, one that started outside any
 * worktree or whose root has since gone, keeps the first root a hook of it
 * resolves. Without `roots` each hook locates its own `cwd`.
 */
export function sessionLocation(
  input: SessionRootInput,
  start: boolean,
  roots: SessionRoots | undefined,
): HookLocation | null {
  if (roots === undefined) return locate(input.cwd);
  const restart =
    start &&
    input.agent_id === undefined &&
    (input.source === undefined || RESTART_SOURCES.has(input.source));
  if (!restart) {
    const kept = roots.get(input.session_id);
    if (kept !== null) return kept;
  }
  const located = locate(input.cwd);
  if (located !== null) roots.set(input.session_id, located);
  else if (restart) roots.delete(input.session_id);
  return located;
}

/**
 * The hook bundles' `SessionRoots`: one file per session under
 * `<runtime dir>/squeal-sessions`, a directory of this user's own
 * (`preparePrivateDir`), named by a hash of the session id. A file another
 * user owns, or whose root is gone, keeps nothing. Nothing removes a file
 * whose session never ends; the runtime dir is cleared at logout or boot.
 */
export function sessionRootFiles(env: NodeJS.ProcessEnv): SessionRoots {
  const dir = join(runtimeDir(env), "squeal-sessions");
  const path = (sessionId: string) =>
    join(dir, createHash("sha256").update(sessionId).digest("hex").slice(0, 32));
  return {
    get: (sessionId) => {
      try {
        return readKept(path(sessionId));
      } catch {
        return null;
      }
    },
    set: (sessionId, location) => {
      try {
        preparePrivateDir(dir, currentUid(), "session root directory");
        const file = path(sessionId);
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify({ root: location.root, commonDir: location.commonDir }));
        renameSync(temp, file);
      } catch {
        // Best effort: the next hook locates its own cwd.
      }
    },
    delete: (sessionId) => {
      try {
        rmSync(path(sessionId), { force: true });
      } catch {
        // Best effort, as `set`.
      }
    },
  };
}

function readKept(file: AbsolutePath): HookLocation | null {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || stat.uid !== currentUid()) return null;
  const kept: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(kept) || typeof kept.root !== "string" || typeof kept.commonDir !== "string") {
    return null;
  }
  return existsSync(kept.root) ? { root: kept.root, commonDir: kept.commonDir } : null;
}
