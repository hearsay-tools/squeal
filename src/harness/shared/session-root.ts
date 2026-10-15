import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { currentUid, preparePrivateDir, runtimeDir } from "../../core/daemon/paths.js";
import { isRecord } from "../../core/fs/index.js";
import type { AbsolutePath } from "../../core/types/index.js";
import { type HookLocation, locate } from "./context.js";

/**
 * Where each session's root, and each of its subagents', is kept between its
 * hook processes (tasks 001-405, 001-415), by `rootKey`. Best effort: a store
 * that cannot be read or written reads as keeping nothing, and each hook then
 * locates its own `cwd`.
 */
export interface SessionRoots {
  get(key: string): HookLocation | null;
  set(key: string, location: HookLocation): void;
  delete(key: string): void;
}

/** Between a session id and an agent id in a subagent's key: neither holds it. */
const AGENT_SEPARATOR = "\0";

/** A main agent's key is its session id; a subagent's adds its agent id. */
export function rootKey(input: Pick<SessionRootInput, "session_id" | "agent_id">): string {
  return input.agent_id === undefined
    ? input.session_id
    : `${input.session_id}${AGENT_SEPARATOR}${input.agent_id}`;
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
 *
 * A subagent (task 001-415, W2b) keeps the root its SubagentStart's own
 * `cwd` resolves, so one isolated in a worktree of its own validates there
 * and one in its parent's worktree is unchanged; `forgetRoot` drops it at
 * its SubagentStop. A subagent with nothing kept uses the session's root.
 */
export function sessionLocation(
  input: SessionRootInput,
  start: boolean,
  roots: SessionRoots | undefined,
): HookLocation | null {
  if (roots === undefined) return locate(input.cwd);
  if (input.agent_id !== undefined) {
    const key = rootKey(input);
    const own = start ? locate(input.cwd) : roots.get(key);
    if (own !== null) {
      if (start) roots.set(key, own);
      return own;
    }
  }
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

/** SessionEnd forgets a session's root, SubagentStop a subagent's. */
export function forgetRoot(
  input: Pick<SessionRootInput, "session_id" | "agent_id">,
  roots: SessionRoots | undefined,
): void {
  roots?.delete(rootKey(input));
}

/**
 * The hook bundles' `SessionRoots`: one file per key under
 * `<runtime dir>/squeal-sessions`, a directory of this user's own
 * (`preparePrivateDir`), named by a hash of the key. A file another user
 * owns, or whose root is gone, keeps nothing. Deleting a session's key
 * deletes its subagents' too, so SessionEnd clears a subagent whose
 * SubagentStop never ran. Nothing removes a file whose session never ends;
 * the runtime dir is cleared at logout or boot.
 */
export function sessionRootFiles(env: NodeJS.ProcessEnv): SessionRoots {
  const dir = join(runtimeDir(env), "squeal-sessions");
  const path = (key: string) => join(dir, keyFile(key));
  return {
    get: (key) => {
      try {
        return readKept(path(key));
      } catch {
        return null;
      }
    },
    set: (key, location) => {
      try {
        preparePrivateDir(dir, currentUid(), "session root directory");
        const file = path(key);
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify({ root: location.root, commonDir: location.commonDir }));
        renameSync(temp, file);
      } catch {
        // Best effort: the next hook locates its own cwd.
      }
    },
    delete: (key) => {
      try {
        rmSync(path(key), { force: true });
        if (key.includes(AGENT_SEPARATOR)) return;
        const agents = `${keyFile(key)}-`;
        for (const name of readdirSync(dir)) {
          if (name.startsWith(agents)) rmSync(join(dir, name), { force: true });
        }
      } catch {
        // Best effort, as `set`.
      }
    },
  };
}

/** A session's file is its id's hash; a subagent's adds `-<agent id hash>`, so SessionEnd finds it. */
function keyFile(key: string): string {
  const [session = "", ...agent] = key.split(AGENT_SEPARATOR);
  const own = hash(session);
  return agent.length === 0 ? own : `${own}-${hash(agent.join(AGENT_SEPARATOR))}`;
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
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
