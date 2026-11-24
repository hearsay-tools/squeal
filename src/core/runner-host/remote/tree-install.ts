import { existsSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { installedDependenciesFingerprint } from "../../keys/environment.js";
import { installCommand } from "../../scheduler/install-command.js";
import { hostTools, type ManagerTools, managerEnv, runOutput } from "./package-manager.js";
import type { InstallAnswer } from "./tree-wire.js";

/*
 * Spec 021 D10 (rows 021-13, 021-24): the install of a remote tree. The host
 * installs from the lockfile when the lockfile's blob differs from its last
 * install, when the `node_modules` that install left is gone, and when the
 * install changed since the host made it. A restore onto a new machine gives
 * the installed folders new file times, so the package manager's own record
 * no longer stands for them, the key reads the folders instead, and every
 * run is refused (`boat-trial.md` D3). The host knows it by its fingerprint
 * of the install, taken right after the install and again now. Such an
 * install is made again from scratch: a repeat install may leave the
 * folders as they are (pnpm's `optimisticRepeatInstall`). So is one whose
 * record an earlier release wrote, without that fingerprint: once, and
 * then its record holds one (review 0.1.454 B1).
 *
 * Row 026-22: the install runs with the host's Node directory on `PATH`,
 * and with a `pnpm` or `yarn` it lacks installed first (`package-manager.ts`).
 */

/** Committed lockfiles, as `installCommand` reads them (`src/core/scheduler/install-command.ts`). */
export const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

/** `installed.json`: the host's last install. */
interface Installed {
  /** The lockfiles' blob ids, by name. */
  readonly locks: Readonly<Record<string, string>>;
  /** Whether it left a `node_modules`: a project without dependencies may have none. */
  readonly modules: boolean;
  /** `installedDependenciesFingerprint` of the root right after it. */
  readonly installed?: string;
}

/** A tree to install. */
export interface InstallPlace {
  readonly root: string;
  /** `installed.json`, beside the root. */
  readonly record: string;
  /** The tree's lockfiles, by name, with their blob ids. */
  readonly locks: Readonly<Record<string, string>>;
  /** A file the daemon wrote lies in `node_modules`: the host never removes it. */
  readonly keepModules: boolean;
  /** The install's output: the host's stderr, never its protocol channel. */
  readonly output: (text: string) => void;
  readonly env: NodeJS.ProcessEnv;
  /**
   * The machine's directory of package managers installed for a tree
   * (row 026-22); by default `pm` beside the tree directories.
   */
  readonly managers?: string;
  /** The Node and npm that install a missing manager; by default this process's. */
  readonly tools?: ManagerTools;
}

/** Installs the tree at `place.root` when its last install no longer stands; says whether it ran. */
export async function installTree(place: InstallPlace): Promise<InstallAnswer> {
  const { root, locks } = place;
  if (Object.keys(locks).length === 0) return { ran: false, command: null };
  const fingerprint = () => installedDependenciesFingerprint(root, root);
  const last = readInstalled(place.record);
  const same =
    last !== null &&
    JSON.stringify(last.locks) === JSON.stringify(locks) &&
    last.modules === existsSync(join(root, "node_modules"));
  const unchanged =
    same && last.installed !== undefined && (await fingerprint()) === last.installed;
  if (unchanged) return { ran: false, command: null };
  // Row 021-24: the same lockfile, but its install changed since, or the record is an earlier
  // release's, which holds no fingerprint to tell (review 0.1.454 B1): made again from scratch.
  if (same && !place.keepModules) {
    await rm(join(root, "node_modules"), { recursive: true, force: true });
  }
  const command = await installCommand(root, readJson(join(root, "package.json")));
  const env = await managerEnv(command, place.env, {
    root,
    managers: place.managers ?? join(dirname(dirname(place.record)), "pm"),
    tools: place.tools ?? hostTools(),
    output: place.output,
  });
  await runOutput("sh", ["-c", command], { cwd: root, env, output: place.output, what: command });
  const made: Installed = {
    locks,
    modules: existsSync(join(root, "node_modules")),
    installed: await fingerprint(),
  };
  const part = `${place.record}.part`;
  await writeFile(part, JSON.stringify(made));
  await rename(part, place.record);
  return { ran: true, command, ...(same ? { again: true as const } : {}) };
}

function readInstalled(path: string): Installed | null {
  const read = readJson(path);
  if (typeof read !== "object" || read === null) return null;
  const { locks, modules } = read as Partial<Installed>;
  return typeof locks === "object" && locks !== null && typeof modules === "boolean"
    ? (read as Installed)
    : null;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
