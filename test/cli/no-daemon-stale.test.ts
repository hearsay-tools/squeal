import { appendFileSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import {
  daemonSuite,
  type FixtureRepo,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  waitReady,
  withStore,
} from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";

/*
 * Spec 026 D2.4 (row 026-09, vision principle 2), against a real daemon of
 * an edit-free policy that stopped on its own: with no daemon, `squeal
 * status`, `code` and `lint` answer at once from the stores, silent while
 * the files on disk are as the last pass saw them, and lead with one notice
 * naming the last revision once an edit or a commit came after it.
 */

const suite = daemonSuite();
const { fixture, daemon } = suite;

const OXLINT = realpathSync(resolve(import.meta.dirname, "../../node_modules/oxlint"));

const CONFIG = {
  "squeal.config.json": JSON.stringify({
    checks: [
      { name: "unit", runner: "vitest", at: "manual" },
      { name: "lint", lint: ["oxlint"], at: "edit" },
    ],
    lint: { enabled: true, tools: ["oxlint"] },
    complexity: { enabled: true },
    coverage: { enabled: false },
    daemon: { unusedExitMinutes: 0.05 },
  }),
  ".oxlintrc.json": JSON.stringify({ categories: { correctness: "error" } }),
};

const NOTICE =
  /^No daemon is running for this worktree, so these results are as of revision (\d+)(?: \(\d\d:\d\d:\d\d UTC\))?, before (.+); the next hook or `squeal start` brings them up to date\.$/;

/** One CLI call in `repo`, in this process: its exit code and its first line. */
async function run(repo: FixtureRepo, args: readonly string[]) {
  let out = "";
  const env: NodeJS.ProcessEnv = { ...repo.env };
  delete env.CODEX_SESSION_ID;
  delete env.PI_SESSION_ID;
  delete env.OPENCODE_SESSION_ID;
  delete env.ANTIGRAVITY_CONVERSATION_ID;
  delete env.CLAUDECODE;
  const code = await main(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      out += text;
    },
    cwd: repo.root,
    env,
  });
  return { code, first: out.split("\n")[0] ?? "", out };
}

const commands = [["status"], ["code"], ["lint"]] as const;

async function firstLines(repo: FixtureRepo) {
  const lines: string[] = [];
  for (const args of commands) {
    const { code, first, out } = await run(repo, args);
    expect(code, out).toBe(0);
    lines.push(first);
  }
  return lines;
}

/** `repo` with oxlint resolvable, as the daemon's lint provider needs it. */
function withOxlint(repo: FixtureRepo): FixtureRepo {
  mkdirSync(join(repo.root, "node_modules"));
  symlinkSync(OXLINT, join(repo.root, "node_modules", "oxlint"));
  return repo;
}

/** The exit of `spawned` within 60 s, or `null`. */
const exitOf = (spawned: SpawnedProcess) =>
  Promise.race([spawned.exited, new Promise<null>((done) => setTimeout(() => done(null), 60_000))]);

describe("the no-daemon staleness notice (spec 026 D2.4, row 026-09)", SLOW, () => {
  it("is silent on an unchanged worktree, and names revision 0 and the edit after a quiet start", async () => {
    const repo = withOxlint(fixture(CONFIG));
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    // An edit-free policy with no consumer: the daemon stops after its capped idle bound (3 s).
    expect(await exitOf(spawned)).toEqual({ code: 0, signal: null });
    // It saw no edit: its results are the start scan's, revision 0.
    expect(withStore(repo, (s) => s.revisions.latest(repo.worktreeId))).toBeNull();

    // As the last pass saw it: no notice from any of the three.
    for (const line of await firstLines(repo)) expect(line).not.toMatch(NOTICE);

    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const late = 1;\n");
    for (const line of await firstLines(repo)) {
      const [, number, what] = NOTICE.exec(line) ?? [];
      expect(number, line).toBe("0");
      expect(what).toBe("changes on disk to 1 file (src/math.ts)");
    }
    // Committed, the edit has no git status line; its stat still differs from the cache's.
    git(repo.root, ["commit", "-qam", "late"]);
    for (const line of await firstLines(repo)) {
      expect(NOTICE.exec(line)?.[2], line).toBe("changes on disk to 1 file (src/math.ts)");
    }
    // JSON stays as it was: the notice is for people and agents reading text.
    expect((await run(repo, ["status", "--json"])).first).toBe("{");
  });

  it("names the revision a daemon recorded and the commit made after it stopped", async () => {
    const repo = withOxlint(fixture(CONFIG));
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    appendFileSync(join(repo.root, "src/strings.ts"), "\nexport const seen = 1;\n");
    const wait = spawnCli(suite.cli, ["status", "--wait", "30000", "src/strings.ts"], {
      cwd: repo.root,
      env: repo.env,
    });
    await wait.exited;
    expect(await exitOf(spawned)).toEqual({ code: 0, signal: null });
    const revision = withStore(repo, (s) => s.revisions.latest(repo.worktreeId)?.number);
    expect(revision, wait.stdout()).toBeGreaterThan(0);
    for (const line of await firstLines(repo)) expect(line).not.toMatch(NOTICE);

    git(repo.root, ["commit", "-qam", "seen"]);
    const head = git(repo.root, ["rev-parse", "--short=7", "HEAD"]).trim();
    for (const line of await firstLines(repo)) {
      const [, number, what] = NOTICE.exec(line) ?? [];
      expect(Number(number), line).toBe(revision);
      expect(what).toBe(`the commit now at HEAD (${head})`);
    }
  });
});
