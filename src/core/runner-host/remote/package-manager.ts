import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/*
 * Spec 026 row 026-22: the package manager a remote tree's install needs.
 * Node 25 and later ship no corepack, so a fresh remote may have Node and
 * npm but no `pnpm` or `yarn`. A manager already on `PATH` is used as it
 * is. A missing one is installed with the npm beside the host's Node, at
 * the version the manifest's `packageManager` names, once per machine into
 * `<managers>/<name>-<version>`; later installs reuse it. Each host makes
 * its copy under a name of its own and renames it into place, so hosts of
 * several trees on one machine never see a half-made copy.
 */

/** The Node and npm a missing manager is installed with. */
export interface ManagerTools {
  /** The directory of the Node that runs the host: added to `PATH` when absent. */
  readonly nodeDir: string;
  /** The npm command: file, then its first arguments. */
  readonly npm: readonly [string, ...string[]];
}

/** The tools of this process: its Node's directory and the npm beside it, else `npm` on `PATH`. */
export function hostTools(): ManagerTools {
  const nodeDir = dirname(process.execPath);
  const cli = join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return { nodeDir, npm: existsSync(cli) ? [process.execPath, cli] : ["npm"] };
}

/** What a missing manager is installed as: the npm package spec and its cache directory's name. */
export interface ManagerSpec {
  readonly name: "pnpm" | "yarn";
  /** `pnpm@10.2.0`, `@yarnpkg/cli-dist@4.5.0`, `pnpm@latest`. */
  readonly spec: string;
  /** `pnpm-10.2.0`, `yarn-latest`. */
  readonly dir: string;
}

/** Strict SemVer 2.0.0 core + optional prerelease: no leading zeroes on numeric fields, hyphens allowed in prerelease. */
const NUM = "(?:0|[1-9]\\d{0,8})";
const PRE = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const VERSION = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-${PRE}(?:\\.${PRE})*)?$`);

/**
 * The spec of `name` as `manifest.packageManager` declares it (`pnpm@10.2.0`,
 * a `+sha512...` suffix dropped), else `<name>@latest`. Yarn 2 and later is
 * `@yarnpkg/cli-dist`; `berry` says a latest Yarn is that one too.
 */
export function managerSpec(name: "pnpm" | "yarn", manifest: unknown, berry: boolean): ManagerSpec {
  const declared =
    typeof manifest === "object" && manifest !== null
      ? (manifest as { packageManager?: unknown }).packageManager
      : undefined;
  const text = typeof declared === "string" ? declared : "";
  const at = text.indexOf("@");
  const manager = at < 0 ? text : text.slice(0, at);
  const version = at < 0 ? "" : (text.slice(at + 1).split("+")[0] ?? "");
  const pinned = manager === name && VERSION.test(version) ? version : null;
  const modern = name === "yarn" && (pinned === null ? berry : !pinned.startsWith("1."));
  const pkg = modern ? "@yarnpkg/cli-dist" : name;
  const dir = `${name}-${pinned ?? (modern ? "berry-latest" : "latest")}`;
  return { name, spec: `${pkg}@${pinned ?? "latest"}`, dir };
}

/** Whether an executable file `name` lies in one of `path`'s directories (POSIX empty/relative entries resolve against `cwd`). */
export function onPath(name: string, path: string | undefined, cwd?: string): boolean {
  if (path === undefined) return false;
  return path.split(delimiter).some((entry) => {
    const dir = entry === "" ? (cwd ?? ".") : cwd !== undefined ? resolve(cwd, entry) : entry;
    return executable(join(dir, name));
  });
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `env` with `dir` last on its `PATH` when it is not there yet, preserving empty and relative segments. */
function withPathDir(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  if (env.PATH === undefined) return { ...env, PATH: dir };
  const dirs = env.PATH.split(delimiter);
  return dirs.includes(dir) ? env : { ...env, PATH: [...dirs, dir].join(delimiter) };
}

/** Where a missing manager is installed, and with what. */
export interface ManagerPlace {
  readonly root: string;
  /** The machine's directory of installed managers. */
  readonly managers: string;
  readonly tools: ManagerTools;
  readonly output: (text: string) => void;
}

/**
 * The env `command` runs under in `place.root`: `env` with the host's Node
 * directory on `PATH`, and, when `command` needs `pnpm` or `yarn` and
 * `PATH` has none, the `.bin` of an installed copy first on it.
 */
export async function managerEnv(
  command: string,
  env: NodeJS.ProcessEnv,
  place: ManagerPlace,
): Promise<NodeJS.ProcessEnv> {
  const withNode = withPathDir(env, place.tools.nodeDir);
  const name = command.split(" ")[0];
  if ((name !== "pnpm" && name !== "yarn") || onPath(name, withNode.PATH, place.root)) {
    return withNode;
  }
  const manifest = readJson(join(place.root, "package.json"));
  const spec = managerSpec(name, manifest, command.includes("--immutable"));
  const bin = await installedManager(spec, withNode, place);
  const nextPath = withNode.PATH === undefined ? bin : `${bin}${delimiter}${withNode.PATH}`;
  return { ...withNode, PATH: nextPath };
}

/** Runs `fn` under an atomic lock file beside `dir` so broken-cache repair never removes a concurrent winner. */
async function withPublishLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${dir}.lock`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        await unlink(lock).catch(() => {});
        continue;
      }
      await sleep(25);
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lock).catch(() => {});
  }
}

/** The `.bin` of `spec`'s copy under `place.managers`, made now when there is none. */
async function installedManager(
  spec: ManagerSpec,
  env: NodeJS.ProcessEnv,
  place: ManagerPlace,
): Promise<string> {
  const dir = join(place.managers, spec.dir);
  const binOf = (at: string) => join(at, "node_modules", ".bin");
  const made = () => executable(join(binOf(dir), spec.name));
  if (made()) return binOf(dir);
  await mkdir(place.managers, { recursive: true });
  const part = `${dir}.${process.pid}-${randomBytes(4).toString("hex")}.part`;
  try {
    await mkdir(part);
    const [file, ...first] = place.tools.npm;
    const args = [...first, "install", "--no-audit", "--no-fund", "--prefix", part, spec.spec];
    await runOutput(file, args, {
      cwd: part,
      env,
      output: place.output,
      what: `npm install ${spec.spec}`,
    });
    if (!executable(join(binOf(part), spec.name))) {
      throw new Error(`npm install ${spec.spec} left no ${spec.name} in its .bin on the remote`);
    }
    // Review 0.1.627 S1: serialize publication/repair so two repairers never remove a valid winner.
    await withPublishLock(dir, async () => {
      if (made()) return;
      await rm(dir, { recursive: true, force: true });
      await rename(part, dir);
    });
    return binOf(dir);
  } finally {
    await rm(part, { recursive: true, force: true });
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** What the output keeps for its error. */
const TAIL = 2_000;

/** Runs `file` with `args`, its output to `output`; rejects naming `what` with its end on a failure. */
export function runOutput(
  file: string,
  args: readonly string[],
  run: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly output: (text: string) => void;
    readonly what: string;
  },
): Promise<void> {
  const { cwd, env, output, what } = run;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const take = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output(text);
      tail = (tail + text).slice(-TAIL);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => reject(new Error(`could not run ${what}: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
        reject(new Error(`${what} failed on the remote (${how}): ${tail.trim()}`));
      }
    });
  });
}
