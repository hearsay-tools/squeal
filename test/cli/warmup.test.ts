import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { readVerdict } from "../../src/cli/verdict.js";
import { daemonSuite, SLOW, spawnCli, withStore } from "../daemon/helpers.js";

/*
 * `squeal warmup`, spec 005 D3 step 4 (row 005-14a): the daemon started from
 * this terminal, then `run --all --wait`, against the real CLI on the
 * scheduler fixture. 0 with every test file current, 1 with known failures
 * and every test file current, 3 without a verdict.
 */

const suite = daemonSuite();

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
    expect(lines[0]).toMatch(/^squeal warmup: the first run covers about \d+ test files, counted/);
    expect(lines[1]).toBe(`Squeal daemon spawned for ${repo.root}`);
    expect(out).toMatch(/^squeal warmup: \d+ of \d+ test files done$/m);
    expect(out).toMatch(/^Checkpoint \S+ completed at revision \d+: no known failures; /m);
    expect(out).toContain(
      "squeal warmup: every test file is current with no known failure. The results carry over",
    );
    everyFileCurrent(repo);
    // A second warm-up finds every file current and runs none.
    const again = warmup(repo);
    expect((await again.exited).code, again.stdout()).toBe(0);
    expect(again.stdout().split("\n")[0]).toMatch(
      /^squeal warmup: the first run covers 0 of \d+ test files, those without a current result$/,
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
    const repo = suite.fixture();
    const run = spawnCli(suite.cli, ["setup", "--yes"], { cwd: repo.root, env: scratchEnv(repo) });
    const exited = await run.exited;
    const out = run.stdout();
    expect(exited, `${out}${run.stderr()}`).toEqual({ code: 0, signal: null });
    expect(out).toContain(
      "Set up Claude Code here (not on the PATH, plugin not installed)?\n  no (default, --yes)",
    );
    expect(out).toMatch(/^squeal warmup: the first run covers /m);
    expect(out).toContain("squeal warmup: every test file is current with no known failure.");
    // No harness on the PATH and no instruction file: setup writes nothing here.
    expect(out).toContain("Changes:\n  none to tracked files\n\nNothing to commit.\n");
    everyFileCurrent(repo);
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
