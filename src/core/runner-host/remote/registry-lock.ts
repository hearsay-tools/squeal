import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

/*
 * Review 0.1.616 S1 (row 026-10): the lock file each read-change-write of
 * `remote-machines.json` holds (`machines-store.ts`). A lock whose holder
 * died, or older than `STALE_LOCK_MS`, is taken over. Review 0.1.658 B4:
 * `tryLocked` tries once, for a caller that must not block its thread.
 */

/** How long a writer waits for the lock before its write fails. */
export const LOCK_WAIT_MS = 10_000;
/** A lock this old is a dead writer's: no write holds it this long. */
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 5;

/** Runs `work` holding the lock file `lock`; throws when it stays held. */
export function locked(lock: string, work: () => void): void {
  const owner = `${process.pid} ${Math.random().toString(36).slice(2)}\n`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!acquire(lock, owner)) {
    if (takeOverStale(lock)) continue;
    if (Date.now() > deadline) throw new Error(`${lock} is held by another writer`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
  }
  holding(lock, owner, work);
}

/** `locked` without a wait: false, and `work` not run, when another writer holds the lock. */
export function tryLocked(lock: string, work: () => void): boolean {
  const owner = `${process.pid} ${Math.random().toString(36).slice(2)}\n`;
  if (!acquire(lock, owner) && !(takeOverStale(lock) && acquire(lock, owner))) return false;
  holding(lock, owner, work);
  return true;
}

function holding(lock: string, owner: string, work: () => void): void {
  try {
    work();
  } finally {
    // Only our own: a writer that took it over as stale holds it now.
    if (readText(lock) === owner) unlinkSync(lock);
  }
}

/** Creates `lock` holding `owner`, never empty; false when it exists. */
function acquire(lock: string, owner: string): boolean {
  const published = `${lock}.${owner.trim().replace(" ", ".")}`;
  writeFileSync(published, owner, { mode: 0o600 });
  try {
    linkSync(published, lock);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (!NO_HARD_LINKS.has(code ?? "")) throw error;
  } finally {
    unlinkSync(published);
  }
  // No hard links here: create, then write; `takeOverStale` waits out an empty lock.
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(fd, owner);
  } finally {
    closeSync(fd);
  }
  return true;
}

const NO_HARD_LINKS: ReadonlySet<string> = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

/** Removes `lock` when its holder died or it is older than `STALE_LOCK_MS`; true when removed. */
function takeOverStale(lock: string): boolean {
  const text = readText(lock);
  if (text === null) return true;
  if (!stale(lock, text)) return false;
  // One takeover at a time: between its check and its removal no other
  // writer removes this lock, so no lock taken after it can be removed.
  const breaker = `${lock}.break`;
  try {
    closeSync(openSync(breaker, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A takeover that died holding it: no takeover holds it this long.
    if (ageMs(breaker) > STALE_LOCK_MS) removeIfThere(breaker);
    return false;
  }
  try {
    if (readText(lock) !== text) return false;
    removeIfThere(lock);
    return true;
  } finally {
    removeIfThere(breaker);
  }
}

/** The holder of `text` died, or the lock is too old for any write; a lock without owner text is busy until then. */
function stale(lock: string, text: string): boolean {
  const age = ageMs(lock);
  if (age > STALE_LOCK_MS) return true;
  const holder = /^(\d+) \S+\n$/.exec(text);
  return holder !== null && !alive(Number(holder[1]));
}

/** Milliseconds since `path` changed; 0 when it is gone, so a missing file is never stale. */
function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function removeIfThere(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Another writer removed it first.
  }
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
