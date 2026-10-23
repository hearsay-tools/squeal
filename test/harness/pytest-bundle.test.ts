import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import { buildDist } from "../../src/harness/build.js";
import { CLAUDE_CODE_PLUGIN } from "../../src/harness/claude-code/build.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { until } from "../e2e/support.js";
import { observeMetafile } from "../helpers/build-inputs.js";
import { requireSynced, type Synced, syncFixture } from "../helpers/pytest-env.js";

/*
 * Spec 007 D4, D6 and review wave 1's input 7: the built CLI, from a temp
 * `dist/` and nowhere near the sources, loads both `.wasm` files and finds
 * `squeal_pytest.py` in its `dist/pytest/`. Its daemon validates a synced
 * copy of the small fixture: a graph that could not load would note it and
 * list no file, and a run without the plugin would complete no file.
 */

const small = resolve(import.meta.dirname, "../fixtures/pytest/small");
const SLOW = { timeout: 300_000 } as const;
/** The fixture's eight tests plus each of its three files' file-level check. */
const CHECKS = 11;

let dist = "";
let synced: Synced = { ok: false, reason: "the sync did not run" };
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
const daemons: ChildProcess[] = [];
beforeAll(async () => {
  // Under /tmp: no `node_modules` above it, so nothing resolves from the sources.
  dist = mkdtempSync("/tmp/sq-pytest-dist-");
  observeMetafile(await buildDist(CLAUDE_CODE_PLUGIN, dist));
  synced = syncFixture(small, "3.13");
}, SLOW.timeout);
afterAll(async () => {
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  if (synced.ok) synced.env.cleanup();
  for (const dir of [dist, runtime]) if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

describe("the bundled CLI and pytest (spec 007)", () => {
  it("ships squeal_pytest.py, sitecustomize.py and both .wasm files in dist/pytest/", () => {
    expect(readdirSync(join(dist, "pytest")).sort()).toEqual([
      "sitecustomize.py",
      "squeal_pytest.py",
      "tree-sitter-python.wasm",
      "web-tree-sitter.wasm",
    ]);
  });

  it("validates a pytest project from the bundle alone", SLOW, async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root);
    writeFileSync(join(root, ".gitignore"), ".venv/\n");
    writeFileSync(
      join(root, "squeal.config.json"),
      `${JSON.stringify({ pytest: [{ name: "small", include: ["tests/**/test_*.py"] }] })}\n`,
    );
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);

    const env = childEnv(runtime);
    const daemon = spawn(process.execPath, [join(dist, "cli/squeal.mjs"), "daemon", root], {
      cwd: root,
      env,
      stdio: "ignore",
    });
    daemons.push(daemon);
    const { socketPathFor } = await import("../../src/core/daemon/paths.js");
    const socket = socketPathFor(worktreeIdFor(root), env);
    await until("the bundled daemon", 60_000, async () => {
      const answer = await ping(socket, 1_000);
      return answer?.phase === "ready" ? answer : null;
    });
    const settled = await until("the bundled baseline", 120_000, async () => {
      const s = readStatus(root);
      if (!s.available) return null;
      if (s.counts.current === CHECKS && s.counts.pending === 0) return s;
      throw new Error(JSON.stringify({ counts: s.counts, notes: s.daemonNotes }));
    });
    expect(settled.knownFailures).toEqual([]);
    expect(settled.daemonNotes.map((n) => n.text).join("\n")).not.toMatch(
      /cannot be built|not found/,
    );
    // The bytecode went to the state directory, not the tree.
    expect(existsSync(join(root, ".git/squeal/pytest"))).toBe(true);
    expect(existsSync(join(root, "tests/__pycache__"))).toBe(false);
  });
});
