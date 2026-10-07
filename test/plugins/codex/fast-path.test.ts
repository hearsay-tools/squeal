import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HooksFile } from "../../../src/cli/codex/hash.js";
import { REPO_ROOT } from "../../../src/harness/claude-code/build.js";
import { runtimeDir } from "../../harness/bundle-helpers.js";

/*
 * Spec 002 D4: Codex runs a hook as `bash -c '<command>'` in the thread's
 * cwd with `PWD` set to it, and expands `${PLUGIN_ROOT}`. The test runs the
 * shipped command that way, with a fake plugin root whose bundles print `ran`.
 * Fixtures live under /tmp, since the test temp dir can sit inside a checkout
 * of this repository, whose store would make every walk up find Squeal.
 */
const hooksJson = JSON.parse(
  readFileSync(join(REPO_ROOT, "plugins/codex/hooks/hooks.json"), "utf8"),
) as HooksFile;
const commandOf = (event: string): string => {
  const command = hooksJson.hooks[event]?.[0]?.hooks[0]?.command;
  if (command === undefined) throw new Error(`no ${event} hook`);
  return command;
};

/** A plugin root whose hook bundles print `ran` and their name. */
function fakePlugin(): string {
  const root = runtimeDir();
  mkdirSync(join(root, "dist"));
  for (const name of ["pre-tool-use", "post-tool-use"]) {
    writeFileSync(join(root, "dist", `${name}.mjs`), `process.stdout.write("ran ${name}\\n");\n`);
  }
  return root;
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly ms: number;
}

function hook(
  event: string,
  cwd: string,
  plugin: string,
  env: Record<string, string> = {},
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn("bash", ["-c", commandOf(event)], {
      cwd,
      env: { PATH: process.env.PATH ?? "", PWD: cwd, PLUGIN_ROOT: plugin, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code, ms: performance.now() - started }));
    // The fast path exits without reading stdin when Squeal is not in use.
    child.stdin.on("error", () => {});
    child.stdin.end(`{"hook_event_name":"${event}","tool_name":"apply_patch"}`);
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
const ran = (event: string) => ({
  stdout: `ran ${event === "PreToolUse" ? "pre-tool-use" : "post-tool-use"}\n`,
  stderr: "",
  code: 0,
});
const EVENTS = ["PreToolUse", "PostToolUse"];

describe("the Codex per-tool hooks' fast path under bash -c (spec 002 D4)", () => {
  it("exits 0 silently outside a Squeal repository", async () => {
    const r = repository();
    const plugin = fakePlugin();
    for (const event of EVENTS) {
      expect(await hook(event, r.main, plugin), event).toMatchObject(SILENT);
      expect(await hook(event, r.linked, plugin), event).toMatchObject(SILENT);
      expect(await hook(event, runtimeDir(), plugin), event).toMatchObject(SILENT);
    }
  });

  it("reaches node in a Squeal repository: main checkout, subdirectory and linked worktree", async () => {
    const r = repository();
    r.store();
    mkdirSync(join(r.linked, "src", "deep"), { recursive: true });
    const plugin = fakePlugin();
    for (const event of EVENTS) {
      expect(await hook(event, r.main, plugin), event).toMatchObject(ran(event));
      expect(await hook(event, r.linked, plugin), event).toMatchObject(ran(event));
      expect(await hook(event, join(r.linked, "src", "deep"), plugin), event).toMatchObject(
        ran(event),
      );
    }
  });

  it("reaches node where only squeal.config.json says Squeal is used", async () => {
    const r = repository();
    writeFileSync(join(r.main, "squeal.config.json"), "{}\n");
    mkdirSync(join(r.main, "pkg"));
    const plugin = fakePlugin();
    expect(await hook("PostToolUse", join(r.main, "pkg"), plugin)).toMatchObject(
      ran("PostToolUse"),
    );
  });

  it("ignores an inherited CLAUDE_PROJECT_DIR that points at a Squeal repository", async () => {
    const squeal = repository();
    squeal.store();
    const other = repository();
    const plugin = fakePlugin();
    const env = { CLAUDE_PROJECT_DIR: squeal.main };
    for (const event of EVENTS) {
      expect(await hook(event, other.main, plugin, env), event).toMatchObject(SILENT);
    }
  });

  it("takes under 10 ms p95 outside Squeal (asserted at load 4 or below, outside CI)", async () => {
    const r = repository();
    const plugin = fakePlugin();
    const samples: number[] = [];
    for (let run = 0; run < 40; run++) {
      const out = await hook(
        EVENTS[run % 2] ?? "PreToolUse",
        run % 4 < 2 ? r.main : r.linked,
        plugin,
      );
      expect(out).toMatchObject(SILENT);
      samples.push(out.ms);
    }
    const sorted = samples.sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
    const load = loadavg()[0] ?? 0;
    console.log(
      `Codex fast path without Squeal: p50 ${sorted[20]?.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, load ${load.toFixed(2)}`,
    );
    if (load > 4 || process.env.CI !== undefined) return;
    expect(p95).toBeLessThan(10);
  });
});
