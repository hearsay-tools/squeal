import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { PLUGIN_DIST } from "../../src/harness/claude-code/build.js";
import { tempDir } from "../store/helpers.js";

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

/** Runs `node <args>` in `cwd` with a minimal environment plus `env`, stdin piped, timed. */
export function runNode(
  args: readonly string[],
  stdin: string,
  env: Readonly<Record<string, string>> = {},
  cwd?: string,
): Promise<BundleRun> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, args, {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
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
 */
export function expectSameFiles(actual: string, expected: string, suffix = ""): void {
  const files = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(suffix))
      .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
      .sort();
  expect(files(actual)).toEqual(files(expected));
  for (const file of files(expected)) {
    expect(readFileSync(join(actual, file)), file).toEqual(readFileSync(join(expected, file)));
  }
}
