import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, type Stats, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { loadConfigFile } from "./daemon/config-file.js";
import { NODE_SHAPE, type NodeSetting } from "./daemon/policy-node.js";

/*
 * Spec 018 D18 (row 018-30): the project's pinned Node runs the daemon. A
 * worktree that pins one exact Node version in `.node-version` or `.nvmrc`
 * gets a daemon on that Node when it is installed, wherever the hook or CLI
 * that starts the daemon runs, so a session's own Node does not decide
 * whether shared results count (the key holds the daemon's
 * `process.version`, D1). Nothing is installed or downloaded. Imported by
 * the daemon's spawn in hooks (task 001-31): `node:` modules and the small
 * config reader only.
 */

/** The pin files at the worktree root, in the order they are read. */
export const PIN_FILES = [".node-version", ".nvmrc"] as const;

/** Why the daemon runs on the session's Node (D19's reasons). */
export type UnpinnedReason = "none" | "range" | "missing" | "session";

/**
 * The Node a worktree's daemon runs on. Found: the `binary` of the pinned
 * `version` (`"26.13.0"`, no `v`). Not used: why, and the pin's text as the
 * file writes it when there is one (`"v26.13.0"`, `"lts/*"`).
 */
export type PinnedNode =
  | { readonly binary: string; readonly version: string }
  | { readonly reason: UnpinnedReason; readonly wanted?: string };

/** An exact version, `x.y.z` with or without a leading `v`. */
const EXACT = /^v?(\d+\.\d+\.\d+)$/;
/** How long one candidate may take to say its version. */
const PROBE_TIMEOUT_MS = 2_000;
/** A PATH candidate's answer: its version, a newline, the binary it runs. */
const SELF = 'process.version + "\\n" + process.execPath';

/**
 * Spec 018 D18: the Node binary the daemon of the worktree at `root` runs
 * on. `node: "session"` in its `squeal.config.json` keeps the session's
 * Node. Otherwise the pin's first value, exact, and installed where nvm,
 * fnm, volta, asdf, mise or n keep that version, or on `env.PATH`; a range
 * or alias is not resolved. The session's own Node at that version is the
 * answer without a lookup. Synchronous, since status reads it inside one
 * read transaction (row 018-31); each candidate binary runs once per
 * process and file. Never throws.
 */
export function pinnedNode(root: string, env: NodeJS.ProcessEnv = process.env): PinnedNode {
  const wanted = readPin(root);
  if (nodeSetting(root) === "session") {
    return wanted === null ? { reason: "session" } : { reason: "session", wanted };
  }
  if (wanted === null) return { reason: "none" };
  const version = EXACT.exec(wanted)?.[1];
  if (version === undefined) return { reason: "range", wanted };
  if (process.versions.node === version) return { binary: process.execPath, version };
  const binary = installed(version, env) ?? onPath(version, root, env);
  return binary === null ? { reason: "missing", wanted } : { binary, version };
}

/**
 * The daemon's `PATH`: the directory of `binary` first, then `path`, so a
 * test that starts `node` gets the daemon's version.
 */
export function pathFirst(binary: string, path: string | undefined): string {
  const dir = dirname(binary);
  return path === undefined || path === "" ? dir : `${dir}${delimiter}${path}`;
}

/**
 * The pin's text: the first value of the first pin file at `root` that has
 * one, a value being a line without its `#` comment, trimmed. `null` when
 * neither file has a value.
 */
export function readPin(root: string): string | null {
  for (const name of PIN_FILES) {
    let text: string;
    try {
      text = readFileSync(join(root, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const value = line.replace(/#.*$/, "").trim();
      if (value !== "") return value;
    }
  }
  return null;
}

/** `squeal.config.json`'s `node` at `root`, by the policy loader's own rule for that key. */
function nodeSetting(root: string): NodeSetting {
  // The file name is the policy loader's `POLICY_FILE`, named here so a hook does not load it.
  return loadConfigFile(join(root, "squeal.config.json"), NODE_SHAPE, {
    node: "project" as NodeSetting,
  }).value.node;
}

/**
 * Where version managers install `version` (`x.y.z`), in D18's order: nvm,
 * fnm, volta, asdf, mise, n. Each honours its own directory variable, else
 * its default under `env.HOME`.
 */
export function managerCandidates(version: string, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? homedir();
  const data = env.XDG_DATA_HOME ?? join(home, ".local", "share");
  const fnm =
    env.FNM_DIR === undefined
      ? [join(data, "fnm"), join(home, ".fnm"), join(home, "Library", "Application Support", "fnm")]
      : [env.FNM_DIR];
  return [
    join(env.NVM_DIR ?? join(home, ".nvm"), "versions", "node", `v${version}`, "bin", "node"),
    ...fnm.map((dir) => join(dir, "node-versions", `v${version}`, "installation", "bin", "node")),
    join(env.VOLTA_HOME ?? join(home, ".volta"), "tools", "image", "node", version, "bin", "node"),
    join(env.ASDF_DATA_DIR ?? join(home, ".asdf"), "installs", "nodejs", version, "bin", "node"),
    join(env.MISE_DATA_DIR ?? join(data, "mise"), "installs", "node", version, "bin", "node"),
    join(env.N_PREFIX ?? "/usr/local", "n", "versions", "node", version, "bin", "node"),
  ];
}

/** The first version manager's binary of `version` that says it is that version. */
function installed(version: string, env: NodeJS.ProcessEnv): string | null {
  for (const binary of managerCandidates(version, env)) {
    const said = probe(binary, ["--version"], { env });
    if (said !== null && said.trim() === `v${version}`) return binary;
  }
  return null;
}

/**
 * The binary of `version` reached through a `node` on `env.PATH`. Such a
 * `node` may be a version manager's shim, which picks its version by its
 * working directory and its tool by argv0, so it is asked from `root` for
 * its version and the binary it runs, and the daemon runs that binary. The
 * session's own Node is skipped: its version is known and is not `version`.
 */
function onPath(version: string, root: string, env: NodeJS.ProcessEnv): string | null {
  const own = real(process.execPath);
  const seen = new Set<string>();
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const candidate = join(dir, "node");
    const resolved = real(candidate);
    if (resolved === null || resolved === own || seen.has(resolved)) continue;
    seen.add(resolved);
    const said = probe(candidate, ["-p", SELF], { env, cwd: root })?.split("\n");
    const binary = said?.[1]?.trim();
    if (said?.[0]?.trim() === `v${version}` && binary !== undefined && isAbsolute(binary)) {
      return binary;
    }
  }
  return null;
}

function real(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** `path`'s stat; `null` when it cannot be read (missing, a file as a directory, no access). */
function fileStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/** What each binary answered, by path, arguments and file identity: once per process and file. */
const answers = new Map<string, string | null>();

/** The output of `binary args`, when it is an executable file and exits 0 in time; else `null`. */
function probe(
  binary: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv; readonly cwd?: string },
): string | null {
  const stat = fileStat(binary);
  if (stat === null || !stat.isFile() || (stat.mode & 0o111) === 0) return null;
  const key = [binary, ...args, stat.ino, stat.size, stat.mtimeMs, options.cwd ?? ""].join("\0");
  const known = answers.get(key);
  if (known !== undefined) return known;
  let said: string | null;
  try {
    said = execFileSync(binary, args, {
      encoding: "utf8",
      env: options.env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PROBE_TIMEOUT_MS,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
  } catch {
    said = null;
  }
  answers.set(key, said);
  return said;
}
