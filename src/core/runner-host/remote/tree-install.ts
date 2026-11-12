import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installedDependenciesFingerprint } from "../../keys/environment.js";
import { installCommand } from "../../scheduler/install-command.js";
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
 * folders as they are (pnpm's `optimisticRepeatInstall`).
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
}

/** What the install's output keeps for its error. */
const TAIL = 2_000;

/** Installs the tree at `place.root` when its last install no longer stands; says whether it ran. */
export async function installTree(place: InstallPlace): Promise<InstallAnswer> {
  const { root, locks } = place;
  if (Object.keys(locks).length === 0) return { ran: false, command: null };
  const fingerprint = () => installedDependenciesFingerprint(root, root);
  const last = readInstalled(place.record);
  const same =
    last !== null &&
    typeof last.installed === "string" &&
    JSON.stringify(last.locks) === JSON.stringify(locks) &&
    last.modules === existsSync(join(root, "node_modules"));
  if (same && (await fingerprint()) === last.installed) return { ran: false, command: null };
  // Row 021-24: the same lockfile, but its install changed since: made again from scratch.
  if (same && !place.keepModules) {
    await rm(join(root, "node_modules"), { recursive: true, force: true });
  }
  const command = await installCommand(root, readJson(join(root, "package.json")));
  await runInstall(command, root, place.output, place.env);
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

/** Runs the install in the root, its output to `output`; rejects with its end on a failure. */
function runInstall(
  command: string,
  root: string,
  output: (text: string) => void,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const take = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output(text);
      tail = (tail + text).slice(-TAIL);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => reject(new Error(`could not run ${command}: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
        reject(new Error(`${command} failed on the remote (${how}): ${tail.trim()}`));
      }
    });
  });
}
