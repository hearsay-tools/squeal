import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { awaitGroupsSync, nulSeparated, StillAlive, signalGroup } from "./process-groups.js";
import { removeTree } from "./remove-tree.js";

/*
 * Row 011-431 (`docs/specifications/011-core/research/ci-flake-census.md`,
 * G3): a test's folder was removed while a process the test or the code
 * under test started still wrote there: a daemon's store process, detached
 * in its own group and alive for its grace, or a detached stand-in CLI.
 * Node 22's `rmSync` `maxRetries` cannot outlast such a writer
 * (`research/enotempty-cleanup.md` finding 1). A scratch folder first ends
 * the detached process groups that started while it existed and name it,
 * waits until no member of them is left (`awaitGroupsSync`), and only then
 * removes the tree (`removeTree`).
 *
 * A group is taken when it leads a session of its own (`detached: true`
 * starts one so), its leader's id was not in use when the folder was made,
 * it is not this process's group, and one of its live members names the
 * folder: in its arguments, its working directory or an environment value.
 * The first two keep every group that existed before the folder out
 * (review 011-336 B1): only what started for it is signalled. Read from
 * `/proc` alone; where it is missing (not Linux) the folder is only removed.
 */

/** How long the taken groups have after their SIGTERM before their SIGKILL. */
const ENDS_MS = 5_000;

/** A folder for one test, removed only after what writes there has ended. */
export interface Scratch {
  readonly dir: string;
  /**
   * Ends the groups that write in `dir`, then removes it. Throws `StillAlive`,
   * and leaves `dir`, when a process outlived its SIGKILL.
   */
  readonly remove: () => void;
}

/** `mkdtempSync(prefix)` as a `Scratch`. */
export function scratchDir(prefix: string): Scratch {
  const before = processIds();
  const dir = mkdtempSync(prefix);
  return { dir, remove: () => removeScratch(dir, before) };
}

/** `dir`, which the caller makes now, as a `Scratch`. */
export function scratchAt(dir: string): Scratch {
  const before = processIds();
  return { dir, remove: () => removeScratch(dir, before) };
}

/**
 * Ends the groups that write in `dir` and started after `before` was read,
 * then removes `dir`. Without `before`, every group that names `dir` is
 * taken: for a folder the test did not make itself.
 */
export function removeScratch(dir: string, before: ReadonlySet<number> = new Set()): void {
  const names = existsSync(dir) ? [...new Set([dir, realpathSync(dir)])] : [dir];
  const groups = groupsNaming(names, before);
  for (const group of groups) signalGroup(group, "SIGTERM");
  const { alive } = awaitGroupsSync(groups, { graceMs: ENDS_MS });
  if (alive.length > 0) throw new StillAlive(`the processes writing in ${dir}`, alive);
  removeTree(dir);
}

/** The ids of the live processes, from `/proc`; none where it is missing. */
export function processIds(): Set<number> {
  try {
    return new Set(
      readdirSync("/proc")
        .filter((name) => /^\d+$/.test(name))
        .map(Number),
    );
  } catch {
    return new Set();
  }
}

/** The groups taken for the folder `names` name (see the top of this file). */
function groupsNaming(names: readonly string[], before: ReadonlySet<number>): number[] {
  const own = groupOf(process.pid);
  const taken = new Set<number>();
  for (const pid of processIds()) {
    if (before.has(pid)) continue;
    const group = groupOf(pid);
    if (group === null || group === own || taken.has(group) || before.has(group)) continue;
    if (namesFolder(pid, names)) taken.add(group);
  }
  return [...taken];
}

/** The group of `pid` when it is alive and that group leads its session, else null. */
function groupOf(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // After the command's name, which can hold spaces and parentheses: state, ppid, pgrp, session.
    const [state, , pgrp, session] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return state === "Z" || pgrp !== session ? null : Number(pgrp);
  } catch {
    return null;
  }
}

/** Whether `pid`'s arguments, working directory or environment name one of `names`. */
function namesFolder(pid: number, names: readonly string[]): boolean {
  const texts = [
    ...(nulSeparated(`/proc/${pid}/cmdline`) ?? []),
    ...(nulSeparated(`/proc/${pid}/environ`) ?? []).flatMap((entry) =>
      entry.slice(entry.indexOf("=") + 1).split(":"),
    ),
  ];
  try {
    texts.push(readlinkSync(`/proc/${pid}/cwd`));
  } catch {
    // Another user's process, or gone.
  }
  return texts.some((text) => names.some((name) => within(text, name)));
}

/** Whether `text` is the path `dir`, or names a path below it. */
function within(text: string, dir: string): boolean {
  return text === dir || text.endsWith(`=${dir}`) || text.includes(`${dir}/`);
}
