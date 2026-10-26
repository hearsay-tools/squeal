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
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isNewerVersion } from "../../core/daemon/version.js";
import { isRecord } from "../../core/fs/index.js";

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73, `research/plugin-cache-cleanup.md`
 * option 2): Codex's own install deletes every other version directory of its
 * plugin cache, so a running session's CLI, skill and recorder would name
 * deleted files. Squeal keeps its own copy of each version in the plugin data
 * directory, which the harness keeps across updates, and the launcher beside
 * the copies, which runs the newest one.
 *
 * Row 011-140 (`research/issue-75-77.md` Q1 and Q4): a copy is named after the
 * running code's version and filled from `PLUGIN_ROOT`, which a test run of
 * unreleased code under a Codex hook's environment names for an older plugin;
 * the copy then held older code, and each successor a hook spawned from it
 * registered old and was stepped down again. So a copy keeps its root's
 * manifest, is made only from a root whose manifest names its version, and is
 * used only while its own manifest does.
 */

/** What a copy holds of the plugin root: its manifest too, which names the code's version. */
const COPIED = ["dist", "skills", ".codex-plugin"] as const;
const MANIFEST = join(".codex-plugin", "plugin.json");
const CLI = join("dist", "cli", "squeal.mjs");
const SKILL = join("skills", "squeal", "SKILL.md");
/** The launcher every plugin ships (spec 005 D3), and where the data directory keeps it. */
const LAUNCHER_SOURCE = join("bin", "squeal-launcher");
const LAUNCHER = join("bin", "squeal");
const VERSION = /^\d+\.\d+\.\d+$/;
/**
 * Squeal's plugin cache and data directory under a Codex home, as the
 * launcher finds the cache and Codex 0.160.1 names the data directory to
 * hooks (`research/plugin-cache-cleanup.md` 2).
 */
const CODEX_CACHE = join("plugins", "cache", "hearsay", "squeal");
const CODEX_DATA = join("plugins", "data", "squeal-hearsay");
/**
 * A copy in the making, `.<version>.<pid>.tmp`, renamed into place when
 * whole, or one being removed, `.<name>.<pid>.gone`: left behind only by a
 * process that was killed.
 */
const LEFT = /^\..+\.(\d+)\.(tmp|gone)$/;
/**
 * Row 005-83 (gh-81): how long a copy stays after it was made, for the
 * sessions that still name its skill, which no process's arguments show: the
 * human's 24 h, a proposal for a session's life (`docs/triage/2026-10-25-digest.md`, D).
 */
const KEEP_MS = 24 * 60 * 60 * 1000;

/** The launcher in the plugin data directory `data`. */
export function dataLauncher(data: string): string {
  return join(data, LAUNCHER);
}

/** The directory of `version`'s copy under `data`. */
export function copyOf(data: string, version: string): string {
  return join(data, "versions", version);
}

/** The version a plugin root's or a copy's manifest names, `null` without one readable. */
function manifestVersion(dir: string): string | null {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
    return isRecord(manifest) && typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/** `file` in `version`'s copy while the copy holds that version's code (row 011-140), else `null`. */
function kept(data: string, version: string, file: string): string | null {
  const dir = copyOf(data, version);
  const path = join(dir, file);
  return existsSync(path) && manifestVersion(dir) === version ? path : null;
}

/**
 * The CLI of `version`'s copy, `null` when there is none or its manifest
 * names another version (row 011-140). A copy is whole once it exists.
 */
export function keptCli(data: string, version: string): string | null {
  return kept(data, version, CLI);
}

/** The plugin data directory whose copy holds the CLI `cli`; `null` for a CLI outside one. */
export function dataOfCopy(cli: string): string | null {
  const versions = dirname(dirname(dirname(dirname(cli))));
  return cli.endsWith(`/${CLI}`) && basename(versions) === "versions" ? dirname(versions) : null;
}

/** The skill of `version`'s copy, `null` when there is none or it holds other code. */
export function keptSkill(data: string, version: string): string | null {
  return kept(data, version, SKILL);
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
 * Keeps `version`'s copy of `root` under `data`: its `dist/`, `skills/` and
 * manifest once, built under a temporary name and renamed into place, so a
 * copy that exists is whole and two session starts make one. The launcher is
 * written when it is missing, and replaced when this version's copy is the
 * newest and its plugin ships another text. Making a copy prunes the others
 * (`prune`). Row 011-140: a copy there whose manifest names another version,
 * or none, is renamed out first, and a root whose manifest does not name
 * `version` makes no copy and writes nothing. Returns the copy's directory,
 * or `null` when none could be made: the caller then runs from `root`, or
 * from its own bundle, as before the first copy.
 */
export function keepVersion({ root, data, version }: KeepOptions): string | null {
  const dir = copyOf(data, version);
  // A version that is no plain release, such as `UNKNOWN_VERSION`, is never pruned: no copy.
  if (!VERSION.test(version) || !existsSync(join(root, CLI))) return null;
  try {
    const versions = join(data, "versions");
    const whole = keptCli(data, version) !== null;
    // Read again just before: another session start may have renamed its whole copy in since.
    if (!whole && existsSync(dir) && manifestVersion(dir) !== version) remove(versions, version);
    if (manifestVersion(root) !== version) return whole ? dir : null;
    let made = false;
    if (!whole) {
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

/**
 * Row 005-77: the CLI to spawn a daemon from when the CLI `cli` runs from
 * Codex's plugin cache, as the launcher runs it before any session of its
 * version kept a copy. That is `version`'s copy in Codex's plugin data
 * directory, kept now (`keepVersion`), so Codex's install of another version
 * deletes the cache directory, not the daemon's runtime. `cli` itself for a
 * CLI elsewhere, such as Claude Code's cache, or when no copy could be made.
 */
export function keptCacheCli(
  cli: string,
  version: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const codex = resolve(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"));
  const root = dirname(dirname(dirname(cli)));
  if (!cli.endsWith(`/${CLI}`) || dirname(root) !== join(codex, CODEX_CACHE)) return cli;
  const data = join(codex, CODEX_DATA);
  return keepVersion({ root, data, version }) === null ? cli : (keptCli(data, version) ?? cli);
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
 * and so does what a killed process left (`LEFT`). Row 005-83: every copy
 * made in the last `KEEP_MS` stays too, whole, since a Codex session names
 * its skill and no process's arguments show it. Each is renamed out of
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
  const since = Date.now() - KEEP_MS;
  for (const other of others) {
    const dir = join(versions, other);
    if (other === keep || running === null || running.includes(`${dir}/`)) continue;
    if (madeAt(dir) <= since) gone.push(other);
  }
  for (const name of gone) remove(versions, name);
}

/**
 * When the copy `dir` was made: its own modification time, which its last
 * entry set while it was filled under its temporary name; the rename into
 * `versions/` keeps it, and nothing writes into a whole copy. `Infinity`
 * when it cannot be read, so it is not removed.
 */
function madeAt(dir: string): number {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Renames `name` out of `versions`, so no reader finds half of it, and removes it. */
function remove(versions: string, name: string): void {
  const doomed = join(versions, `.${name}.${process.pid}.gone`);
  try {
    renameSync(join(versions, name), doomed);
    rmSync(doomed, { recursive: true, force: true });
  } catch {
    // Removed by another session start already.
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
