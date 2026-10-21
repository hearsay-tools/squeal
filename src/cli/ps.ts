import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { currentUid } from "../core/daemon/paths.js";
import { userConfigPath } from "../core/daemon/user-config.js";
import { findWorktreeRoot, resolveCommonDir } from "../core/fs/index.js";
import type { Flag, PsPlaces } from "../core/ps/model.js";
import { createProcSource } from "../core/ps/proc.js";
import { render } from "../core/ps/render.js";
import { noFlags, SAMPLE_MS, type Snapshot, takeSnapshot } from "../core/ps/snapshot.js";
import type { PsSource } from "../core/ps/source.js";
import type { AbsolutePath } from "../core/types/index.js";
import type { CliIo } from "./main.js";

/*
 * Spec 014 D1: `squeal ps [--repo] [--full] [--json]` and `squeal ps
 * --leftovers`. One snapshot of every Squeal daemon of this user on this
 * host, their test processes and the host's totals, and the flags of what
 * should not be up. It needs no daemon and starts none; it writes no store,
 * signals no process and connects to no socket. It exits 0 without a flag,
 * 1 with any, 2 on a usage error, and 3, Squeal's code for no verdict, on a
 * platform other than Linux and macOS (D10) or when no snapshot could be
 * taken.
 */

const USAGE = "usage: squeal ps [--repo] [--full] [--json]\n       squeal ps --leftovers\n";

/** The source of each platform `ps` covers (D10). */
const SOURCES: Partial<Record<NodeJS.Platform, () => PsSource>> = {
  linux: () => createProcSource(),
};

/** What tests replace: the platform and its source, the flags, the wait and the paths of the host. */
export interface PsCommandOptions {
  readonly platform?: NodeJS.Platform;
  /** The source of `platform`; `null` where `ps` covers none. */
  readonly sourceFor?: (platform: NodeJS.Platform) => PsSource | null;
  /** D7: `flag` of `flags.ts`. */
  readonly flag?: Flag;
  readonly wait?: (ms: number) => Promise<void>;
  /** The directory `squeal-<uid>` and the other `squeal-*` directories lie in: `/tmp` (011 C9). */
  readonly tempDir?: AbsolutePath;
  readonly uid?: number;
}

interface PsArgs {
  readonly repo: boolean;
  readonly full: boolean;
  readonly json: boolean;
  readonly leftovers: boolean;
}

export async function psCommand(
  args: readonly string[],
  io: CliIo,
  options: PsCommandOptions = {},
): Promise<number> {
  const parsed = parseArgs(args);
  if (typeof parsed === "string") {
    io.stderr(`squeal ps: ${parsed}\n\n${USAGE}`);
    return 2;
  }
  const platform = options.platform ?? process.platform;
  const source = (options.sourceFor ?? ((p) => SOURCES[p]?.() ?? null))(platform);
  if (source === null) {
    io.stderr(`squeal ps: ${platform} is not covered; squeal ps runs on Linux and macOS\n`);
    return 3;
  }
  const cwd = io.cwd ?? process.cwd();
  const commonDir = commonDirOf(cwd);
  if (parsed.repo && commonDir === null) {
    io.stderr(`squeal ps --repo: ${resolve(cwd)} is not inside a git repository\n\n${USAGE}`);
    return 2;
  }
  let snapshot: Snapshot;
  try {
    snapshot = await takeSnapshot({
      source,
      places: placesOf(io.env ?? process.env, commonDir, options),
      flag: options.flag ?? noFlags,
      full: parsed.full,
      repo: parsed.repo,
      // The leftover walk needs no CPU window.
      sampleMs: parsed.leftovers ? 0 : SAMPLE_MS,
      now: io.now ?? Date.now,
      wait: options.wait ?? ((ms) => sleep(ms)),
    });
  } catch (error) {
    // Exit 1 says a flag holds; a snapshot that failed has no answer.
    io.stderr(
      `squeal ps: no snapshot: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 3;
  }
  const { shape, leftovers } = snapshot;
  if (parsed.leftovers) {
    io.stdout(leftovers.map((path) => `${path}\n`).join(""));
    return 0;
  }
  io.stdout(parsed.json ? `${JSON.stringify(shape)}\n` : render(shape, { full: parsed.full }));
  return shape.flags === 0 ? 0 : 1;
}

function parseArgs(args: readonly string[]): PsArgs | string {
  const known = new Set(["--repo", "--full", "--json", "--leftovers"]);
  const unknown = args.find((a) => !known.has(a));
  if (unknown !== undefined) return `unknown option "${unknown}"`;
  const leftovers = args.includes("--leftovers");
  if (leftovers && args.some((a) => a !== "--leftovers"))
    return "--leftovers prints the leftover paths and nothing else; it takes no other option";
  return {
    repo: args.includes("--repo"),
    full: args.includes("--full"),
    json: args.includes("--json"),
    leftovers,
  };
}

/** The git common dir of the worktree around `cwd`; `null` outside one (D1). */
function commonDirOf(cwd: string): AbsolutePath | null {
  try {
    const root = findWorktreeRoot(resolve(cwd));
    return root === null ? null : resolveCommonDir(root);
  } catch {
    // A `.git` that cannot be read names no repository `ps` can narrow to.
    return null;
  }
}

function placesOf(
  env: Readonly<Record<string, string | undefined>>,
  commonDir: AbsolutePath | null,
  options: PsCommandOptions,
): PsPlaces {
  const xdg = env.XDG_RUNTIME_DIR;
  return {
    uid: options.uid ?? currentUid(),
    home: env.HOME !== undefined && env.HOME !== "" ? env.HOME : homedir(),
    userConfig: userConfigPath(env),
    runtimeDir: xdg !== undefined && xdg !== "" && isAbsolute(xdg) ? xdg : null,
    tempDir: options.tempDir ?? "/tmp",
    commonDir,
  };
}
