import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

/*
 * What the plugin checks once at init, in OpenCode's process (spec 008 D4):
 * whether Squeal is in use here, and which Node runs the bridge. Only
 * `node:fs`, `node:path` and `node:child_process`.
 */

/**
 * The floor of `engines.node`, set by the bundles' esbuild `define`
 * (`nodeFloor` in src/harness/build.ts). Undeclared under `tsc` and Vitest,
 * where `typeof` reads it as `undefined` and `manifestFloor` reads it.
 */
declare const __SQUEAL_NODE_FLOOR__: string | undefined;

/**
 * `engines.node`'s floor in the root `package.json`, three directories above
 * this module in `src/` and in the `tsc` build alike. The bundles never read
 * it: their `define` holds the floor.
 */
function manifestFloor(): string {
  const manifest = readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8");
  const range = (JSON.parse(manifest) as { engines?: { node?: unknown } }).engines?.node;
  const floor = typeof range === "string" ? /^>=(\d+\.\d+)$/.exec(range)?.[1] : undefined;
  if (floor === undefined) {
    throw new Error(`engines.node is ${JSON.stringify(range)}, not >=<major>.<minor>`);
  }
  return floor;
}

let floor: string | undefined;

/**
 * Squeal's minimum Node as `major.minor`, `engines.node` in the root
 * `package.json` (011-86): the bundles' `define`, else `manifestFloor`. Read
 * at first use, never at import: the CLI imports this module for
 * `usesSquealAt` alone, and the daemon tests run copies of the `tsc` build
 * whose manifest names only a version (`buildAt`).
 */
export function minimumNode(): string {
  floor ??= typeof __SQUEAL_NODE_FLOOR__ === "string" ? __SQUEAL_NODE_FLOOR__ : manifestFloor();
  return floor;
}

/** How long the plugin waits for `node -p process.versions.node` at init. */
export const NODE_PROBE_MS = 2_000;

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const firstLine = (path: string): string => readFileSync(path, "utf8").split("\n")[0] ?? "";

/**
 * 001 D9's `sh` fast path, in-process: `dir` or its worktree root holds a
 * `squeal.config.json`, or the repository's git common dir holds a store
 * (`squeal/`). The walk up stops at the first `.git`, file or directory; a
 * `.git` file names the git dir, whose `commondir` names the common one.
 * Never throws.
 */
export function usesSquealAt(dir: string): boolean {
  try {
    if (dir === "") return false;
    let root = dir;
    if (isFile(join(root, "squeal.config.json"))) return true;
    while (!existsSync(join(root, ".git"))) {
      const up = dirname(root);
      if (up === root) return false;
      root = up;
    }
    if (isFile(join(root, "squeal.config.json"))) return true;
    let git = join(root, ".git");
    if (isFile(git)) {
      const named = firstLine(git)
        .replace(/^gitdir:/, "")
        .trim();
      git = isAbsolute(named) ? named : join(root, named);
      const common = isFile(join(git, "commondir")) ? firstLine(join(git, "commondir")).trim() : "";
      if (common !== "") git = isAbsolute(common) ? common : join(git, common);
    }
    return existsSync(join(git, "squeal"));
  } catch {
    return false;
  }
}

/** The first executable regular file named `node` on `path`, or `null`. */
export function nodeOnPath(path: string | undefined): string | null {
  for (const dir of (path ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "node");
    try {
      accessSync(candidate, constants.X_OK);
      if (isFile(candidate)) return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** Whether `version` (`process.versions.node`) is at least `minimumNode()`. */
export function meetsMinimum(version: string): boolean {
  const [major, minor] = version.trim().split(".").map(Number);
  if (major === undefined || minor === undefined || Number.isNaN(major) || Number.isNaN(minor))
    return false;
  const [leastMajor = 0, leastMinor = 0] = minimumNode().split(".").map(Number);
  return major > leastMajor || (major === leastMajor && minor >= leastMinor);
}

/** Runs `node -p process.versions.node`; its output, or `null` on a failure or past `timeoutMs`. */
export function nodeVersion(node: string, timeoutMs = NODE_PROBE_MS): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(node, ["-p", "process.versions.node"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() : null);
    });
  });
}

/**
 * D4: a Node of at least `minimumNode()` on `PATH`, looked up once at init, never
 * `process.execPath`, which is OpenCode. `null` when there is none.
 */
export async function findNode(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const node = nodeOnPath(env.PATH);
  if (node === null) return null;
  const version = await nodeVersion(node);
  return version !== null && meetsMinimum(version) ? node : null;
}
