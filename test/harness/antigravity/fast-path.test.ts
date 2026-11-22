import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_PLUGIN_DIR } from "../../../src/harness/antigravity/build.js";
import { runtimeDir } from "../bundle-helpers.js";

/*
 * Spec 024 D4: Antigravity runs a plugin's hook with the plugin root as its
 * working directory, so `hooks/run --if-squeal` takes the workspace from the
 * first top-level `"cwd":"..."` of the stdin payload and exits 0 silently
 * when that directory has no Squeal. Otherwise it passes the payload byte-exact
 * to its arguments. Fixtures live under /tmp, since the test temp dir can sit
 * inside a checkout of this repository, whose store would make every walk up
 * find Squeal.
 */

const RUN = join(ANTIGRAVITY_PLUGIN_DIR, "hooks/run");

interface Run {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly code: number | null;
  readonly ms: number;
}

/** `hooks/run` with `args`, from the plugin root, `payload` on stdin, timed. */
function hookRun(
  payload: string | Buffer,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(RUN, [...args], {
      cwd: ANTIGRAVITY_PLUGIN_DIR,
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ stdout: Buffer.concat(out), stderr, code, ms: performance.now() - started }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(payload);
  });
}

/** The fast path with `echo ran` as the hook. */
const echoRan = (payload: string) => hookRun(payload, ["--if-squeal", "echo", "ran"]);

/** An Antigravity-shaped payload: keys in protojson's alphabetical order. */
function payload(cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    artifactDirectoryPath: "/home/user/.gemini/antigravity-cli/brain/x",
    continuationActive: false,
    conversationId: "00000000-0000-4000-8000-000000000001",
    cwd,
    hookEventName: "PreToolUse",
    ...extra,
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

const SILENT = { stderr: "", code: 0 };
const ran = (r: Run) =>
  expect({ out: r.stdout.toString("utf8"), code: r.code }).toEqual({ out: "ran\n", code: 0 });
const silent = (r: Run) => {
  expect(r).toMatchObject(SILENT);
  expect(r.stdout.length).toBe(0);
};

describe("Antigravity's hooks/run fast path (spec 024 D4)", () => {
  it("exits 0 without arguments, before reading stdin", async () => {
    silent(await hookRun(payload("/nonexistent"), []));
  });

  it("execs its arguments without --if-squeal, stdin passed through", async () => {
    const r = await hookRun("abc", ["cat"]);
    expect(r.stdout.toString("utf8")).toBe("abc");
    expect(r.code).toBe(0);
  });

  it("is silent in a repository with neither config nor store, main and linked", async () => {
    const r = repository();
    silent(await echoRan(payload(r.main)));
    silent(await echoRan(payload(r.linked)));
    silent(await echoRan(payload(join(r.linked, "nested", "dir"))));
    silent(await echoRan(payload("/nonexistent/dir")));
  });

  it("runs the hook where the repository has a store: main checkout and linked worktree", async () => {
    const r = repository();
    r.store();
    ran(await echoRan(payload(r.main)));
    ran(await echoRan(payload(r.linked)));
    mkdirSync(join(r.linked, "src"));
    ran(await echoRan(payload(join(r.linked, "src"))));
  });

  it("runs the hook where only squeal.config.json says Squeal is used", async () => {
    const r = repository();
    writeFileSync(join(r.linked, "squeal.config.json"), "{}\n");
    ran(await echoRan(payload(r.linked)));
    silent(await echoRan(payload(r.main)));
  });

  it("follows a relative gitdir: and an absolute commondir", async () => {
    const root = runtimeDir();
    const common = join(runtimeDir(), "common");
    mkdirSync(join(common, "squeal"), { recursive: true });
    mkdirSync(join(root, "wt", "gitdir"), { recursive: true });
    writeFileSync(join(root, "wt", ".git"), "gitdir:   gitdir");
    writeFileSync(join(root, "wt", "gitdir", "commondir"), common);
    ran(await echoRan(payload(join(root, "wt"))));
  });

  it("never matches a fake cwd inside the prompt, before or after the real key", async () => {
    const squeal = repository();
    squeal.store();
    const plain = repository();
    const fake = `see {"cwd":"${squeal.main}"} and "cwd":"${squeal.main}"`;
    // The prompt after the key, as Antigravity's order puts `toolCall`.
    silent(await echoRan(payload(plain.main, { toolCall: { args: { Prompt: fake } } })));
    // A key sorted before `cwd`, holding the fake.
    const before = JSON.stringify({ aPrompt: fake, cwd: plain.main });
    silent(await echoRan(before));
  });

  it("falls through to the hook on an unclear cwd: empty, missing, backslash escape, past 4 KB", async () => {
    const plain = repository();
    ran(await echoRan(payload("")));
    ran(await echoRan(JSON.stringify({ conversationId: "x", hookEventName: "PreToolUse" })));
    ran(await echoRan(payload(`${plain.main}\\dir`)));
    ran(await echoRan(payload(`${plain.main}/a"b`)));
    const late = JSON.stringify({ aPrompt: "x".repeat(5000), cwd: plain.main });
    ran(await echoRan(late));
  });

  it("passes a 100 KB UTF-8 payload with quotes and newlines byte-exact", async () => {
    const r = repository();
    r.store();
    const prompt = `zażółć "gęślą" \\ jaźń\n${'ą€😀"\\n'.repeat(16_000)}`;
    const body = payload(r.main, { lastUserInput: prompt });
    expect(Buffer.byteLength(body)).toBeGreaterThan(100_000);
    for (const tail of ["", "\n", "\r\n\n\n"]) {
      const bytes = Buffer.from(body + tail, "utf8");
      const out = await hookRun(bytes, ["--if-squeal", "cat"]);
      expect(out.code).toBe(0);
      expect(out.stdout.equals(bytes), JSON.stringify(tail)).toBe(true);
    }
  });

  it("parses under LC_ALL=C and gives the hook the caller's LC_ALL back", async () => {
    const r = repository();
    r.store();
    const show = ["--if-squeal", "sh", "-c", `printf %s "\${LC_ALL-unset}"`];
    const unset = await hookRun(payload(r.main), show);
    expect(unset.stdout.toString("utf8")).toBe("unset");
    const utf8 = await hookRun(payload(r.main), show, { LC_ALL: "C.UTF-8" });
    expect(utf8.stdout.toString("utf8")).toBe("C.UTF-8");
    expect(readFileSync(RUN, "utf8")).toMatch(/\n {2}LC_ALL=C\n/);
  });

  it("takes under 10 ms p95 without Squeal (asserted at load 4 or below, outside CI)", async () => {
    const r = repository();
    const samples: number[] = [];
    for (let run = 0; run < 40; run++) {
      const out = await echoRan(payload(run % 2 === 0 ? r.main : r.linked));
      silent(out);
      samples.push(out.ms);
    }
    const sorted = samples.sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
    const load = loadavg()[0] ?? 0;
    console.log(
      `Antigravity sh fast path without Squeal: p50 ${sorted[20]?.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, load ${load.toFixed(2)}`,
    );
    if (load > 4 || process.env.CI !== undefined) return;
    expect(p95).toBeLessThan(10);
  });
});
