import { readFileSync, realpathSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { gitDirOf, isRecord } from "../fs/index.js";
import type { AbsolutePath, Capacity, LoadedUserConfig, UserConfig } from "../types/index.js";
import {
  describeProblems,
  type Kept,
  loadConfigFile,
  positiveInteger,
  type Shape,
} from "./config-file.js";

/**
 * Spec 001 D11 Capacity: "`$XDG_CONFIG_HOME/squeal/config.json` (default
 * `~/.config/squeal/config.json`), never committed". An `XDG_CONFIG_HOME`
 * that is empty or relative is ignored, as the XDG specification says.
 */
export function userConfigPath(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  const xdg = env.XDG_CONFIG_HOME;
  const base =
    xdg !== undefined && xdg !== "" && isAbsolute(xdg)
      ? xdg
      : join(env.HOME !== undefined && env.HOME !== "" ? env.HOME : homedir(), ".config");
  return join(base, "squeal", "config.json");
}

/** D11 Capacity: "The host's slots default to the CPU count minus one", at least 1. */
export function defaultHostSlots(cpus: number = availableParallelism()): number {
  return Math.max(1, cpus - 1);
}

/**
 * Reads the user-level config under D11's loader rules: never throws, a
 * missing file is the defaults, and every problem is kept for one note. A
 * `capacity.hostSlots` above the CPU count is cut to it, and the note says so.
 * `cpus` is injected for tests; the default is `os.availableParallelism()`.
 */
export function loadUserConfig(
  options: {
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly cpus?: number | undefined;
  } = {},
): LoadedUserConfig {
  const path = userConfigPath(options.env);
  const cpus = options.cpus ?? availableParallelism();
  const defaults: UserConfig = {
    capacity: { hostSlots: defaultHostSlots(cpus), projects: {} },
  };
  const { value, problems } = loadConfigFile(path, SHAPE, defaults);
  const { hostSlots } = value.capacity;
  if (hostSlots <= cpus) return { path, config: value, problems };
  // 011 C10 Size as amended 2026-10-21 (row 011-98): a slot bounds cores too, so no more than the CPUs.
  return {
    path,
    config: { ...value, capacity: { ...value.capacity, hostSlots: cpus } },
    problems,
    cut: `"capacity.hostSlots" ${hostSlots} is above the CPU count, ${cpus}; it is cut to ${cpus}`,
  };
}

/**
 * What the daemons of the repository at `repositoryRoot` may use. A project
 * cap above the host's slots is the host's slots.
 */
export function resolveCapacity(config: UserConfig, repositoryRoot: AbsolutePath): Capacity {
  const { hostSlots, projects } = config.capacity;
  const project = projects[normalize(repositoryRoot)];
  return project === undefined
    ? { hostSlots }
    : { hostSlots, projectSlots: Math.min(project.slots, hostSlots) };
}

/**
 * One daemon's capacity (D11 Capacity). Each call reads the file again and
 * notes its problems as the daemon notes `squeal.config.json`'s, one note
 * per distinct problem set, none when the newest note about the file already
 * says the same. The daemon calls it when it starts and sizes its pool from
 * that reading, so an edit applies to daemons started after (D11 as amended).
 */
export function capacityReader(options: {
  readonly repositoryRoot: AbsolutePath;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly cpus?: number | undefined;
  /** The newest persisted note whose text starts with `path`, or `null`. */
  readonly lastNote: (path: AbsolutePath) => string | null;
  readonly note: (text: string) => void;
}): () => Capacity {
  let told: string | null = null;
  return () => {
    const { path, config, problems, cut } = loadUserConfig(options);
    const said = [
      ...(problems.length > 0 ? [describeProblems(problems)] : []),
      ...(cut === undefined ? [] : [cut]),
    ];
    const text = said.length > 0 ? `${path}: ${said.join("; ")}` : null;
    if (text !== null && text !== told && options.lastNote(path) !== text) options.note(text);
    told = text;
    return resolveCapacity(config, options.repositoryRoot);
  };
}

/**
 * The repository root `capacity.projects` names, shared by every worktree of
 * the repository: its main worktree's root, read from Git's layout rather
 * than from the common directory's name (review 001-384, B3).
 *
 * - The worktree at `root` is the main one when its git dir is the common
 *   dir: an ordinary repository, a `--separate-git-dir` one, a submodule.
 * - A linked worktree's main root is the common dir's `core.worktree` (a
 *   submodule's checkout) or its parent, whichever has the common dir as its
 *   git dir.
 * - Git records no main worktree for a bare repository, nor for a linked
 *   worktree of a `--separate-git-dir` one: the common dir names those.
 */
export function repositoryRootOf(root: AbsolutePath, commonDir: AbsolutePath): AbsolutePath {
  if (gitDirIs(root, commonDir)) return root;
  for (const candidate of [coreWorktree(commonDir), dirname(commonDir)]) {
    if (candidate !== null && gitDirIs(candidate, commonDir)) return normalize(candidate);
  }
  return commonDir;
}

/** The worktree at `worktree` has `commonDir` as its own git dir. */
function gitDirIs(worktree: AbsolutePath, commonDir: AbsolutePath): boolean {
  try {
    const gitDir = gitDirOf(worktree);
    return gitDir !== null && realpathSync(gitDir) === realpathSync(commonDir);
  } catch {
    return false;
  }
}

/** `core.worktree` in the common dir's config, resolved against it, as Git resolves it. */
function coreWorktree(commonDir: AbsolutePath): AbsolutePath | null {
  let text: string;
  try {
    text = readFileSync(join(commonDir, "config"), "utf8");
  } catch {
    return null;
  }
  let core = false;
  for (const line of text.split("\n")) {
    const section = /^\s*\[\s*([^\]\s"]+)/.exec(line);
    if (section?.[1] !== undefined) {
      core = section[1].toLowerCase() === "core";
      continue;
    }
    const entry = core ? /^\s*worktree\s*=\s*(.*?)\s*$/i.exec(line) : null;
    if (entry?.[1]) return resolve(commonDir, entry[1].replace(/^"(.*)"$/, "$1"));
  }
  return null;
}

/**
 * `capacity.projects`: a map from an absolute repository root path to
 * `{ "slots": n }`. A bad entry is one problem and is left out, the others
 * are kept, as `slow.include` keeps its good globs. Paths are compared after
 * `realpath` when they exist, so a symlinked spelling names the same root.
 */
const projects = (value: unknown): string | Kept => {
  if (!isRecord(value)) return 'an object from repository root path to { "slots": n }';
  const kept: Record<AbsolutePath, { slots: number }> = {};
  const problems: string[] = [];
  for (const [root, entry] of Object.entries(value)) {
    const at = `"capacity.projects[${root}]"`;
    if (!isAbsolute(root)) {
      problems.push(`${at} must name an absolute path; it is left out`);
      continue;
    }
    const why = entryProblem(entry);
    if (why !== null) {
      problems.push(`${at} ${why}; it is left out`);
      continue;
    }
    const slots = (entry as { slots: number }).slots;
    const key = normalize(root);
    // Two spellings of one root: the tighter cap holds.
    kept[key] = { slots: Math.min(slots, kept[key]?.slots ?? slots) };
  }
  return { kept, problems };
};

function entryProblem(entry: unknown): string | null {
  if (!isRecord(entry)) return `must be { "slots": n }, got ${JSON.stringify(entry)}`;
  const unknown = Object.keys(entry).find((key) => key !== "slots");
  if (unknown !== undefined) return `has unknown key "${unknown}"`;
  const expected = positiveInteger(entry.slots);
  return expected === null
    ? null
    : `"slots" must be ${String(expected)}, got ${JSON.stringify(entry.slots) ?? "undefined"}`;
}

function normalize(path: AbsolutePath): AbsolutePath {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const SHAPE: Shape = {
  capacity: { hostSlots: positiveInteger, projects },
};
