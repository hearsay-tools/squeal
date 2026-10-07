import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runtimeDir } from "./bundle-helpers.js";

/*
 * Task 001-93: PreToolUse runs on every tool, so in a repository without
 * Squeal its command exits from `sh` before Node starts. The test runs the
 * exact script hooks.json ships, with the Node command replaced by `echo ran`.
 * Fixtures live under /tmp, since the test temp dir can sit inside a checkout
 * of this repository, whose store would make every walk up find Squeal.
 */

interface HookCommand {
  readonly command: string;
  readonly args: readonly string[];
}
const hooksJson = JSON.parse(
  readFileSync(join(REPO_ROOT, "plugins/claude-code/hooks/hooks.json"), "utf8"),
) as { hooks: Record<string, { hooks: HookCommand[] }[]> };
const commandOf = (event: string): HookCommand => {
  const hook = hooksJson.hooks[event]?.[0]?.hooks[0];
  if (hook === undefined) throw new Error(`no ${event} hook`);
  return hook;
};
const [flag, script, name] = commandOf("PreToolUse").args;

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly ms: number;
}

/** The fast path with `$CLAUDE_PROJECT_DIR` at `project`, run from `cwd`, timed. */
function fastPath(project: string | undefined, cwd = runtimeDir()): Promise<Run> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const env = {
      PATH: process.env.PATH ?? "",
      ...(project === undefined ? {} : { CLAUDE_PROJECT_DIR: project }),
    };
    const child = spawn("sh", [flag ?? "", script ?? "", name ?? "", "echo", "ran"], { env, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code, ms: performance.now() - started }));
    // The fast path exits without reading stdin when Squeal is not in use.
    child.stdin.on("error", () => {});
    child.stdin.end('{"hook_event_name":"PreToolUse","tool_name":"Bash"}');
  });
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdio: "ignore",
  });

/** A main checkout with one commit and a linked worktree of it, both under /tmp. */
function repository() {
  const main = join(runtimeDir(), "main");
  mkdirSync(main);
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const linked = join(runtimeDir(), "linked");
  git(main, "worktree", "add", "-q", linked);
  return { main, linked, store: () => mkdirSync(join(main, ".git", "squeal")) };
}

const SILENT = { stdout: "", stderr: "", code: 0 };
const RAN = { stdout: "ran\n", stderr: "", code: 0 };

describe("the per-tool hooks' sh fast path (task 001-93)", () => {
  it("is the same script for PreToolUse and PostToolBatch, and ends by running Node", () => {
    for (const event of ["PreToolUse", "PostToolBatch"]) {
      const { command, args } = commandOf(event);
      expect(command, event).toBe("sh");
      expect(args.slice(0, 3), event).toEqual([flag, script, name]);
      expect(args.slice(3, 5), event).toEqual(["node", "--disable-warning=ExperimentalWarning"]);
    }
    expect(script).toMatch(/exec "\$@"$/);
  });

  it("exits 0 silently in a repository with neither config nor store", async () => {
    const r = repository();
    expect(await fastPath(r.main)).toMatchObject(SILENT);
    expect(await fastPath(r.linked)).toMatchObject(SILENT);
    expect(await fastPath(join(r.linked, "nested", "dir"))).toMatchObject(SILENT);
    expect(await fastPath(undefined)).toMatchObject(SILENT);
  });

  it("runs the hook where the repository has a store: main checkout and linked worktree", async () => {
    const r = repository();
    r.store();
    expect(await fastPath(r.main)).toMatchObject(RAN);
    expect(await fastPath(r.linked)).toMatchObject(RAN);
    // A subdirectory as the project dir, and no project dir but the hook's cwd.
    mkdirSync(join(r.linked, "src"));
    expect(await fastPath(join(r.linked, "src"))).toMatchObject(RAN);
    expect(await fastPath(undefined, r.linked)).toMatchObject(RAN);
  });

  it("runs the hook where only squeal.config.json says Squeal is used", async () => {
    const r = repository();
    writeFileSync(join(r.linked, "squeal.config.json"), "{}\n");
    expect(await fastPath(r.linked)).toMatchObject(RAN);
    expect(await fastPath(r.main)).toMatchObject(SILENT);
    // Not a git worktree at all, as the brief's config-only case.
    const plain = runtimeDir();
    writeFileSync(join(plain, "squeal.config.json"), "{}\n");
    expect(await fastPath(plain)).toMatchObject(RAN);
  });

  it("follows a relative gitdir: and an absolute commondir", async () => {
    const root = runtimeDir();
    const common = join(runtimeDir(), "common");
    mkdirSync(join(common, "squeal"), { recursive: true });
    mkdirSync(join(root, "wt", "gitdir"), { recursive: true });
    writeFileSync(join(root, "wt", ".git"), "gitdir:   gitdir");
    writeFileSync(join(root, "wt", "gitdir", "commondir"), common);
    expect(await fastPath(join(root, "wt"))).toMatchObject(RAN);
  });

  it("is silent for a .git file whose gitdir is gone", async () => {
    const root = runtimeDir();
    writeFileSync(join(root, ".git"), "gitdir: /nonexistent/worktrees/wt\n");
    expect(await fastPath(root)).toMatchObject(SILENT);
  });

  it("takes under 10 ms p95 without Squeal (asserted at load 4 or below, outside CI)", async () => {
    const r = repository();
    const samples: number[] = [];
    for (let run = 0; run < 40; run++) {
      const project = run % 2 === 0 ? r.main : r.linked;
      const out = await fastPath(project, project);
      expect(out).toMatchObject(SILENT);
      samples.push(out.ms);
    }
    const sorted = samples.sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
    const load = loadavg()[0] ?? 0;
    console.log(
      `sh fast path without Squeal: p50 ${sorted[20]?.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, load ${load.toFixed(2)}`,
    );
    if (load > 4 || process.env.CI !== undefined) return;
    expect(p95).toBeLessThan(10);
  });
});
