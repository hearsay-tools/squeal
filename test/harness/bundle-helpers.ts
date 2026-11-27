import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { ensureWriteMarkers } from "../../src/core/store/write-markers.js";
import { PLUGIN_DIR, PLUGIN_DIST } from "../../src/harness/claude-code/build.js";
import { check, result } from "../state/helpers.js";
import { tempDir } from "../store/helpers.js";
import { type SquealRepo, squealRepo } from "./helpers.js";
import { testUserDirs } from "./user-dirs.js";

export interface BundleRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly ms: number;
}

/**
 * Where the bundles run from: the committed `dist`, or `SQUEAL_TEST_DIST`, so a
 * worker that may not rebuild `dist` can measure its change from bundles built
 * elsewhere (`bundleOptions(<dir>)`).
 */
const DIST = process.env.SQUEAL_TEST_DIST ?? PLUGIN_DIST;

/**
 * Runs a hook bundle the way hooks.json does: `node --disable-warning=... <bundle>`, stdin
 * piped. `dist` defaults to the Claude Code plugin's; the Codex tests pass bundles they built.
 */
export function runBundle(
  name: string,
  stdin: string,
  env: Readonly<Record<string, string>> = {},
  dist: string = DIST,
): Promise<BundleRun> {
  return runNode(["--disable-warning=ExperimentalWarning", join(dist, `${name}.mjs`)], stdin, env);
}

/**
 * Runs a hook bundle the way users run it since row 025-07: through the plugin's
 * `hooks/run node --disable-warning=... <bundle>`, with Node's compile cache in
 * `cacheHome` (`XDG_CACHE_HOME`), which `hooks/run` fills. The node path is this
 * process's, so it ends in `/node` as the launcher requires. Row 025-19.
 * `launcher` is the command before the node path: Claude Code's `hooks/run` by
 * default; Antigravity's, with `--if-squeal` where its hooks.json has it (row 025-21).
 */
export function runLaunched(
  name: string,
  stdin: string,
  cacheHome: string,
  env: Readonly<Record<string, string>> = {},
  dist: string = DIST,
  launcher: readonly [string, ...string[]] = [join(PLUGIN_DIR, "hooks/run")],
): Promise<BundleRun> {
  const [command, ...flags] = launcher;
  const args = [
    ...flags,
    process.execPath,
    "--disable-warning=ExperimentalWarning",
    join(dist, `${name}.mjs`),
  ];
  return runTimed(command, args, stdin, {
    ...env,
    XDG_CACHE_HOME: cacheHome,
  });
}

/**
 * The latency tests' store, the size of a small project: 50 test files of 10
 * checks, every check passing, and the write markers a daemon arms at its
 * start (row 025-18), without which hooks take a slower path users never take.
 */
export function latencyStore(files = 50, checksPerFile = 10): SquealRepo {
  const r = squealRepo();
  const results = [];
  for (let f = 0; f < files; f++) {
    const file = { project: "", path: `src/m${f}.test.ts` };
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: file, key: `k${f}`, revision: 1, pending: null },
    ]);
    for (let c = 0; c < checksPerFile; c++) {
      results.push(
        result(check(`m${f} > case ${c}`, file), "pass", {
          key: `k${f}`,
          worktreeId: r.worktreeId,
        }),
      );
    }
  }
  r.apply(r.pass(), ...results);
  ensureWriteMarkers(r.store);
  return r;
}

/**
 * The environment Codex's adapter gives the runtime bundle it loads (spec 025
 * D7.2, `enableOwnCompileCache`): Node's compile cache in Squeal's directory
 * under `cacheHome`, marked as Squeal's own. Node fills it on the first run.
 * Row 025-21.
 */
export function adapterCompileCache(cacheHome: string): Record<string, string> {
  return {
    NODE_COMPILE_CACHE: join(cacheHome, "squeal", "compile-cache"),
    SQUEAL_OWN_COMPILE_CACHE: "1",
  };
}

/**
 * The minimal environment `runNode` gives: PATH, the real HOME, then `env`.
 * Review 0.1.658 B5: private `XDG_CONFIG_HOME` and `XDG_STATE_HOME` unless
 * `env` names its own, so a CLI daemon started so never reads or prunes the
 * user's remote machines.
 */
export function testProcessEnv(env: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...testUserDirs(), ...env };
}

/** Runs `node <args>` in `cwd` with a minimal environment plus `env`, stdin piped, timed. */
export function runNode(
  args: readonly string[],
  stdin: string,
  env: Readonly<Record<string, string>> = {},
  cwd?: string,
): Promise<BundleRun> {
  return runTimed(process.execPath, args, stdin, env, cwd);
}

function runTimed(
  command: string,
  args: readonly string[],
  stdin: string,
  env: Readonly<Record<string, string>>,
  cwd?: string,
): Promise<BundleRun> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, {
      env: testProcessEnv(env),
      ...(cwd === undefined ? {} : { cwd }),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
        ms: performance.now() - started,
      }),
    );
    child.stdin.end(stdin);
  });
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A short runtime dir for daemon sockets; socket paths are limited to 108 bytes. */
export function runtimeDir(): string {
  const dir = mkdtempSync("/tmp/sq-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A directory outside any git worktree. The test temp dir can sit inside a
 * checkout, so this one is made under /tmp.
 */
export function outsideGit(): string {
  return runtimeDir();
}

/** A unix socket that accepts connections, standing in for a live daemon. */
export function liveSocket(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => socket.end());
    cleanups.push(() => server.close());
    server.listen(path, () => resolve(server));
  });
}

/** A CLI stand-in for spawned daemons: records that it ran, does nothing else. */
export function quietCli(): { cli: string; ran: string } {
  const dir = tempDir("squeal-cli-");
  const ran = join(dir, "ran");
  const cli = join(dir, "cli.mjs");
  writeFileSync(
    cli,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(ran)}, "");\n`,
  );
  return { cli, ran };
}

/**
 * The drift check: `actual` holds exactly the files of `expected` ending in
 * `suffix` (every file when empty), byte for byte, at the same relative paths.
 * `Buffer.equals`, not `toEqual`, which walks a 400 kB bundle byte by byte
 * (review 002 wave 1, S3).
 */
export function expectSameFiles(actual: string, expected: string, suffix = ""): void {
  const files = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(suffix))
      .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
      .sort();
  expect(files(actual)).toEqual(files(expected));
  for (const file of files(expected)) {
    const same = readFileSync(join(actual, file)).equals(readFileSync(join(expected, file)));
    expect(same, `${file} differs from the build`).toBe(true);
  }
}
