import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { isNewerVersion } from "../../core/daemon/version.js";

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73, `research/plugin-cache-cleanup.md`
 * option 2): Codex's own install deletes every other version directory of its
 * plugin cache, so a running session's CLI, skill and recorder would name
 * deleted files. Squeal keeps its own copy of each version in the plugin data
 * directory, which the harness keeps across updates, and the launcher beside
 * the copies, which runs the newest one.
 */

/** What a copy holds of the plugin root. */
const COPIED = ["dist", "skills"] as const;
const CLI = join("dist", "cli", "squeal.mjs");
const SKILL = join("skills", "squeal", "SKILL.md");
/** The launcher every plugin ships (spec 005 D3), and where the data directory keeps it. */
const LAUNCHER_SOURCE = join("bin", "squeal-launcher");
const LAUNCHER = join("bin", "squeal");
const VERSION = /^\d+\.\d+\.\d+$/;
/**
 * A copy in the making, `.<version>.<pid>.tmp`, renamed into place when
 * whole, or one being removed, `.<name>.<pid>.gone`: left behind only by a
 * process that was killed.
 */
const LEFT = /^\..+\.(\d+)\.(tmp|gone)$/;

/** The launcher in the plugin data directory `data`. */
export function dataLauncher(data: string): string {
  return join(data, LAUNCHER);
}

/** The directory of `version`'s copy under `data`. */
export function copyOf(data: string, version: string): string {
  return join(data, "versions", version);
}

/** The CLI of `version`'s copy, `null` when there is none. A copy is whole once it exists. */
export function keptCli(data: string, version: string): string | null {
  const cli = join(copyOf(data, version), CLI);
  return existsSync(cli) ? cli : null;
}

/** The plugin data directory whose copy holds the CLI `cli`; `null` for a CLI outside one. */
export function dataOfCopy(cli: string): string | null {
  const versions = dirname(dirname(dirname(dirname(cli))));
  return cli.endsWith(`/${CLI}`) && basename(versions) === "versions" ? dirname(versions) : null;
}

/** The skill of `version`'s copy, `null` when there is none. */
export function keptSkill(data: string, version: string): string | null {
  const skill = join(copyOf(data, version), SKILL);
  return existsSync(skill) ? skill : null;
}

export interface KeepOptions {
  /** The running plugin's root: what is copied. */
  readonly root: string;
  /** The plugin data directory. */
  readonly data: string;
  /** The running plugin's version: the copy's name. */
  readonly version: string;
}

/**
 * Keeps `version`'s copy of `root` under `data`: its `dist/` and `skills/`
 * once, built under a temporary name and renamed into place, so a copy that
 * exists is whole and two session starts make one. The launcher is written
 * when it is missing, and replaced when this version's copy is the newest and
 * its plugin ships another text. Making a copy prunes the others (`prune`).
 * Returns the copy's directory, or `null` when none could be made: the caller
 * then runs from `root`, as before the first copy.
 */
export function keepVersion({ root, data, version }: KeepOptions): string | null {
  const dir = copyOf(data, version);
  // A version that is no plain release, such as `UNKNOWN_VERSION`, is never pruned: no copy.
  if (!VERSION.test(version) || !existsSync(join(root, CLI))) return null;
  try {
    const versions = join(data, "versions");
    let made = false;
    if (keptCli(data, version) === null) {
      mkdirSync(versions, { recursive: true });
      const part = join(versions, `.${version}.${process.pid}.tmp`);
      rmSync(part, { recursive: true, force: true });
      for (const name of COPIED) {
        if (existsSync(join(root, name))) {
          cpSync(join(root, name), join(part, name), { recursive: true, dereference: true });
        }
      }
      try {
        renameSync(part, dir);
        made = true;
      } catch {
        // Another session start of this version made it first.
        rmSync(part, { recursive: true, force: true });
      }
    }
    writeLauncher(root, data, version);
    if (made) prune(data, version);
    return keptCli(data, version) === null ? null : dir;
  } catch {
    return null;
  }
}

/** `<data>/bin/squeal` from the plugin's launcher: when missing, or from the newest copy. */
function writeLauncher(root: string, data: string, version: string): void {
  const target = dataLauncher(data);
  const source = join(root, LAUNCHER_SOURCE);
  if (!existsSync(source)) return;
  if (existsSync(target)) {
    if (copies(data).some((v) => isNewerVersion(v, version))) return;
    if (readFileSync(target, "utf8") === readFileSync(source, "utf8")) return;
  }
  mkdirSync(join(data, "bin"), { recursive: true });
  const part = `${target}.${process.pid}.tmp`;
  copyFileSync(source, part);
  chmodSync(part, 0o755);
  renameSync(part, target);
}

/** The versions with a copy under `data`. */
function copies(data: string): string[] {
  try {
    return readdirSync(join(data, "versions")).filter((v) => VERSION.test(v));
  } catch {
    return [];
  }
}

/**
 * 009-18's rule (`install.sh` `previous` and `in_use`), after `version`'s
 * copy is made: the newest other copy stays, and so does every copy a
 * running process names, such as a daemon spawned from it; the others go,
 * and so does what a killed process left (`LEFT`). Each is renamed out of
 * `versions/` first, so no reader finds half a copy. When the process list
 * cannot be read, no copy is removed.
 */
function prune(data: string, version: string): void {
  const versions = join(data, "versions");
  const others = copies(data).filter((v) => v !== version);
  const keep = others.reduce<string | null>(
    (a, b) => (a === null || isNewerVersion(b, a) ? b : a),
    null,
  );
  const running = processArgs();
  const gone = readdirSync(versions).filter((name) => {
    const left = LEFT.exec(name);
    return left !== null && !alive(Number(left[1]));
  });
  for (const other of others) {
    if (other !== keep && running !== null && !running.includes(`${join(versions, other)}/`)) {
      gone.push(other);
    }
  }
  for (const name of gone) {
    const doomed = join(versions, `.${name}.${process.pid}.gone`);
    try {
      renameSync(join(versions, name), doomed);
      rmSync(doomed, { recursive: true, force: true });
    } catch {
      // Removed by another session start already.
    }
  }
}

/** Every running process's arguments, as `install.sh` `in_use` reads them; `null` when `ps` fails. */
function processArgs(): string | null {
  const ps = spawnSync("ps", ["-A", "-o", "args="], { encoding: "utf8" });
  return ps.status === 0 && typeof ps.stdout === "string" ? ps.stdout : null;
}

/** Whether process `pid` runs; one this user may not signal runs too. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
