import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { readVerdict } from "../../src/cli/verdict.js";
import { progressText } from "../../src/cli/warmup.js";
import { readIgnoredReads } from "../../src/core/status/index.js";
import { buildCli, daemonSuite, SLOW, spawnCli, withStore } from "../daemon/helpers.js";

/*
 * `squeal warmup`, spec 005 D3 step 4 (row 005-14a): the daemon started from
 * this terminal, then `run --all --wait`, against the real CLI on the
 * scheduler fixture. 0 with every test file current, 1 with known failures
 * and every test file current, 3 without a verdict.
 */

// With the observe recorder the real build ships, so a warm-up records ignored reads (005-29),
// and the node:test runtime files `tsc` does not emit, where the compiled `runtime.js` looks.
const suite = daemonSuite({ observe: true }, (options) => {
  const built = buildCli(options);
  const runtime = join(dirname(dirname(built.cli)), "runners/node-test/runtime");
  cpSync(join(import.meta.dirname, "../../src/runners/node-test/runtime"), runtime, {
    recursive: true,
  });
  return built;
});

/** Long enough for a progress line or two at one poll a second. */
const HELD = `import { expect, it } from "vitest";

it("takes a while", async () => {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(1).toBe(1);
});
`;

const FAILING = `import { expect, it } from "vitest";

it("fails", () => {
  expect(1).toBe(2);
});
`;

function warmup(repo: ReturnType<typeof suite.fixture>, env = repo.env) {
  return spawnCli(suite.cli, ["warmup"], { cwd: repo.root, env });
}

function everyFileCurrent(repo: ReturnType<typeof suite.fixture>) {
  const verdict = withStore(repo, (store) => readVerdict(store, repo.worktreeId));
  expect(verdict.testFiles).toBeGreaterThan(0);
  expect(verdict.byClass).toMatchObject({ current: verdict.testFiles, pending: 0 });
}

describe("squeal warmup on a real daemon", SLOW, () => {
  it("exits 0 and leaves every test file current, saying the count first and progress as it goes", async () => {
    const repo = suite.fixture({ "test/held.test.ts": HELD });
    const run = warmup(repo);
    const exited = await run.exited;
    const out = run.stdout();
    expect(exited, `${out}${run.stderr()}`).toEqual({ code: 0, signal: null });
    const lines = out.split("\n");
    expect(lines[0]).toMatch(
      /^squeal warmup: runs about \d+ test files, counted from the repository/,
    );
    expect(lines[1]).toBe(`Squeal daemon spawned for ${repo.root}`);
    expect(out).toMatch(/^squeal warmup: \d+ of \d+ test files done$/m);
    expect(out).toMatch(/^Checkpoint \S+ completed at revision \d+: no known failures; /m);
    expect(out).toContain(
      "squeal warmup: every test file is current with no known failure. The results carry over",
    );
    everyFileCurrent(repo);
    // A second warm-up finds every file current and still re-runs all of them (001-312).
    const again = warmup(repo);
    expect((await again.exited).code, again.stdout()).toBe(0);
    expect(again.stdout().split("\n")[0]).toMatch(
      /^squeal warmup: runs all \d+ test files, current ones too, to record the ignored paths each reads$/,
    );
    expect(again.stdout().split("\n")[1]).toBe(`Squeal daemon alive for ${repo.root}`);
  });

  it("exits 1 on known failures, every test file current", async () => {
    const repo = suite.fixture({ "test/fails.test.ts": FAILING });
    const run = warmup(repo);
    const exited = await run.exited;
    const out = run.stdout();
    expect(exited, `${out}${run.stderr()}`).toEqual({ code: 1, signal: null });
    expect(out).toMatch(/^Checkpoint \S+ completed at revision \d+: 1 known failure: 1 test; /m);
    expect(out).toContain("FAIL  test/fails.test.ts > fails");
    expect(out).toContain("squeal warmup: every test file has a result, with the known failures");
    everyFileCurrent(repo);
  });

  it("exits 3 when no daemon can be started", async () => {
    const repo = suite.fixture();
    // The daemon it spawns is a script that does not exist: none ever answers.
    const run = warmup(repo, { ...repo.env, SQUEAL_CLI: join(repo.root, "missing.js") });
    const exited = await run.exited;
    const out = run.stdout();
    expect(exited, `${out}${run.stderr()}`).toEqual({ code: 3, signal: null });
    expect(run.stderr()).toContain("squeal: no daemon could be reached or started for");
    expect(out).toContain("No verdict: no daemon could be started for the warm-up");
    expect(out).toContain("squeal warmup: no verdict");
  });
});

/**
 * Reads `build/out.txt`, which `.gitignore` leaves out. node:test keys what
 * a run loads, never what it reads, so no key holds it (spec 016 D4 keeps a
 * git-ignored path a Vitest file reads).
 */
const READS_BUILD = `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("reads the gitignored build output", () => {
  assert.equal(readFileSync(new URL("../build/out.txt", import.meta.url), "utf8"), "built\\n");
});
`;
const SLOW_READER = "nt/build.test.mjs";
const FAST_READER = "nt/fast-build.test.mjs";

/**
 * Row 005-29 (spec 005 D3, 001-307): a slow node:test file and a fast one
 * read the gitignored `build/out.txt`. A load bound no host meets holds each
 * slow run 8 s, so a slow file made stale runs under the warm-up's
 * checkpoint, not in a slow pass of the daemon's own before the warm-up
 * asks. `node` is named: setup's daemon has only `git` on its PATH.
 */
function readsIgnored() {
  const config = {
    nodeTest: [{ name: "nt", node: process.execPath, include: ["nt/*.test.mjs"] }],
    slow: { include: [SLOW_READER], maxLoadPerCpu: 1e-9, maxDeferMs: 8000 },
  };
  return suite.fixture({
    ".gitignore": "src/gen/\nnode_modules/\n.squeal-logs/\nbuild/\n",
    "build/out.txt": "built\n",
    [SLOW_READER]: READS_BUILD,
    [FAST_READER]: READS_BUILD,
    "squeal.config.json": `${JSON.stringify(config)}\n`,
  });
}

/** Until the daemon has seen an edit: some test file is no longer current. */
async function untilNotCurrent(repo: ReturnType<typeof suite.fixture>): Promise<void> {
  for (let i = 0; i < 300; i++) {
    const { testFiles, byClass } = withStore(repo, (store) => readVerdict(store, repo.worktreeId));
    if (byClass.current < testFiles) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the daemon never saw the edit");
}

describe("the warm-up's ignored reads on a real daemon", SLOW, () => {
  it("stores nothing for a plain run --all; the warm-up asks for the record and says what it holds", async () => {
    const repo = readsIgnored();
    const config = readFileSync(join(repo.root, "squeal.config.json"), "utf8");
    const start = spawnCli(suite.cli, ["start"], { cwd: repo.root, env: repo.env });
    expect((await start.exited).code, start.stderr()).toBe(0);
    const plain = spawnCli(suite.cli, ["run", "--all", "--wait"], {
      cwd: repo.root,
      env: repo.env,
    });
    expect((await plain.exited).code, `${plain.stdout()}${plain.stderr()}`).toBe(0);
    expect(withStore(repo, (store) => readIgnoredReads(store, repo.worktreeId))).toBeNull();
    // The warm-up's own checkpoint runs the slow file: no checkpoint is open to join.
    appendFileSync(join(repo.root, SLOW_READER), "// edited\n");
    await untilNotCurrent(repo);
    const run = warmup(repo);
    const exited = await run.exited;
    const out = run.stdout();
    expect(exited, `${out}${run.stderr()}`).toEqual({ code: 0, signal: null });
    // The warm-up asked for the record: its checkpoint's id is the one the daemon stored.
    const stored = withStore(repo, (store) => readIgnoredReads(store, repo.worktreeId));
    expect(out).toContain(`Checkpoint ${stored?.checkpoint} completed at revision `);
    const entry = Object.entries(stored?.files ?? {}).find(([id]) =>
      id.endsWith(`\0${SLOW_READER}`),
    );
    expect(entry?.[1]).toEqual({ paths: ["build/out.txt"], more: 0 });
    expect(out).toContain(
      `Suggestions; squeal warmup applies none:\n  ${SLOW_READER} read 1 gitignored path, unkeyed: a change to it re-runs nothing, and no input declaration keys a gitignored path; a test of build output Squeal does not produce belongs in its runner's exclude (vitest.exclude, or its project's exclude), for you or CI to run\n    build/out.txt\n`,
    );
    expect(out).not.toContain("no ignored read recorded");
    // A fast file's reads are no slow suggestion.
    expect(out).not.toContain(FAST_READER);
    expect(readFileSync(join(repo.root, "squeal.config.json"), "utf8")).toBe(config);
  });
});

/**
 * Row 005-39 (`research/e2e-setup.md` defect 2): the load bound no host
 * meets holds the slow file for `maxDeferMs`, long enough for several polls;
 * the warm-up names that wait in the status line's words, once per change.
 */
describe(
  "the warm-up's progress while the slow tier waits for load, on a real daemon",
  SLOW,
  () => {
    it("says the slow file waits for host load to drop, and stops saying so once it runs", async () => {
      const repo = suite.fixture({
        "test/held.test.ts": HELD,
        "squeal.config.json": `${JSON.stringify({ slow: { include: ["test/held.test.ts"], maxLoadPerCpu: 1e-9, maxDeferMs: 6000 } })}\n`,
      });
      const run = warmup(repo);
      const exited = await run.exited;
      const out = run.stdout();
      expect(exited, `${out}${run.stderr()}`).toEqual({ code: 0, signal: null });
      const waiting = out.match(
        /^squeal warmup: \d+ of \d+ test files done; 1 slow test file waiting for host load to drop$/gm,
      );
      // Fast files may finish while the slow one waits: each change of count is a new line.
      expect(waiting?.length ?? 0, out).toBeGreaterThanOrEqual(1);
      const progress = out.match(/^squeal warmup: \d+ of \d+ test files done.*$/gm) ?? [];
      expect(new Set(progress).size, out).toBe(progress.length);
      // The held file runs 3 s once the bound passes: the wait is no longer claimed.
      expect(progress.at(-1), out).toMatch(/^squeal warmup: \d+ of \d+ test files done$/);
      everyFileCurrent(repo);
    });
  },
);

/**
 * A scratch HOME, Claude Code and Codex config dirs, and a PATH holding only
 * `git`: neither harness CLI, nor the installed plugin's `bin/`, can be found.
 */
function scratchEnv(repo: ReturnType<typeof suite.fixture>): NodeJS.ProcessEnv {
  const home = mkdtempSync("/tmp/sq-home-");
  suite.cleanup(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const git = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  symlinkSync(git, join(bin, "git"));
  return {
    ...repo.env,
    HOME: home,
    PATH: bin,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    CODEX_HOME: join(home, ".codex"),
  };
}

describe("squeal setup --yes on a real daemon", SLOW, () => {
  it("applies the defaults and warms up through the same code, every test file current", async () => {
    const repo = readsIgnored();
    const run = spawnCli(suite.cli, ["setup", "--yes"], { cwd: repo.root, env: scratchEnv(repo) });
    const exited = await run.exited;
    const out = run.stdout();
    expect(exited, `${out}${run.stderr()}`).toEqual({ code: 0, signal: null });
    expect(out).toContain(
      "Set up Claude Code here (not on the PATH, plugin not installed)?\n  no (default, --yes)",
    );
    expect(out).toMatch(/^squeal warmup: runs (all|about) /m);
    expect(out).toContain("squeal warmup: every test file is current with no known failure.");
    // Setup declares no input (task 004-81): the warm-up observes the slow file (001-312: it
    // never joins), and its gitignored read is unkeyed, pointed at the runner's exclude.
    expect(out).toContain(`${SLOW_READER} read 1 gitignored path, unkeyed`);
    expect(out).toContain("belongs in its runner's exclude (vitest.exclude");
    expect(out).not.toContain("no ignored read recorded");
    // No harness on the PATH and no input to declare: setup writes nothing.
    expect(out).toMatch(/Changes:\n {2}none to tracked files\n\nNothing to commit\.\n$/);
    everyFileCurrent(repo);
  });
});

describe("the warm-up's progress line", () => {
  it("counts the files done, and names the slow files the load guard holds", () => {
    expect(progressText(1, 3, 0)).toBe("1 of 3 test files done");
    expect(progressText(1, 3, 2)).toBe(
      "1 of 3 test files done; 2 slow test files waiting for host load to drop",
    );
    expect(progressText(0, 1, 1)).toBe(
      "0 of 1 test file done; 1 slow test file waiting for host load to drop",
    );
  });
});

describe("squeal warmup arguments", () => {
  function capture(cwd: string) {
    const out = { stdout: "", stderr: "" };
    const io: CliIo = {
      stdout: (t) => {
        out.stdout += t;
      },
      stderr: (t) => {
        out.stderr += t;
      },
      cwd,
    };
    return { io, out };
  }

  it("takes none", async () => {
    const { io, out } = capture("/");
    expect(await main(["warmup", "--yes"], io)).toBe(2);
    expect(out.stderr).toContain("usage: squeal warmup");
  });

  it("exits 1 outside a git worktree", async () => {
    const { io, out } = capture("/");
    expect(await main(["warmup"], io)).toBe(1);
    expect(out.stderr).toContain("is not inside a git worktree");
  });
});
