import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privateReport } from "../../scripts/check-private.js";
import { REPO_ROOT } from "../../src/harness/build.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

// Row private-material-guard: CI fails a push whose added lines hold an absolute home path, a
// recorded agent session log or a private denylist entry. Every value here is made up.
const SCRIPT = join(REPO_ROOT, "scripts/check-private.ts");
const DENY = "secret-client-repo";
const DENY_ENV = { SQUEAL_PRIVATE_DENYLIST: `\n  Other-Made-Up-Word \n${DENY}\n` };
const ALLOW = "test/fixtures/codex-hooks/**\ntest/harness/recorded/*.jsonl\n";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/** A repository with a clean first commit, which is the base; returns it and that commit. */
function repo(): { root: string; base: string } {
  const dir = tempDir("squeal-check-private-");
  cleanups.push(dir.cleanup);
  initRepo(dir.path, {
    ".private-allow": ALLOW,
    "src/a.ts": "export const a = 1;\nconst old = '/home/alice/old';\n",
  });
  return { root: dir.path, base: git(dir.path, ["rev-parse", "HEAD"]).trim() };
}

function commit(root: string, files: Record<string, Buffer | string>): void {
  for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "change"]);
}

const problems = (root: string, base: string, env: Record<string, string> = DENY_ENV) =>
  privateReport(root, base, env).problems;

describe("privateReport", () => {
  it("fails an added home path under /home and /Users, and passes the names user, runner and squeal-e2e", () => {
    const { root, base } = repo();
    commit(root, {
      "src/b.ts": "const a = 1;\nconst p = '/home/alice/project';\nconst q = '/Users/bob/x';\n",
      "src/c.ts":
        "'/home/user/project' '/Users/user/x' https://example.com/home/carol/ ~/x\n" +
        "'/home/runner/work' '/home/squeal-e2e/fixture'\n",
    });
    expect(problems(root, base)).toEqual([
      "src/b.ts:2: holds an absolute home path",
      "src/b.ts:3: holds an absolute home path",
    ]);
  });

  it("reads only added lines: a home path kept or removed in a changed file passes", () => {
    const { root, base } = repo();
    commit(root, { "src/a.ts": "export const a = 2;\nconst old = '/home/alice/old';\n" });
    expect(problems(root, base)).toEqual([]);
    commit(root, { "src/a.ts": "export const a = 2;\n" });
    expect(problems(root, base)).toEqual([]);
  });

  it("fails a recorded session log line, and a pretty-printed JSON file with its keys", () => {
    const { root, base } = repo();
    const hook = { session_id: "abc", cwd: "/tmp/x", hook_event_name: "Stop" };
    commit(root, {
      "logs/a.jsonl": `{"x":1}\n${JSON.stringify(hook)}\n${JSON.stringify({ transcript_path: "/tmp/t" })}\n`,
      "logs/b.json": `${JSON.stringify(hook, null, 2)}\n`,
      "logs/c.json": `${JSON.stringify({ session_id: "abc" }, null, 2)}\n`,
      "src/d.ts": "const keys = ['session_id', 'cwd'];\n",
    });
    expect(problems(root, base)).toEqual([
      "logs/a.jsonl:2: holds a recorded agent session log",
      "logs/a.jsonl:3: holds a recorded agent session log",
      "logs/b.json:2: holds a recorded agent session log",
    ]);
  });

  it("fails a denylist hit in a line or an added file name, case-insensitively, never naming it", () => {
    const { root, base } = repo();
    commit(root, {
      "src/b.ts": `const a = 1;\n// see ${DENY.toUpperCase()} for this\n`,
      [`notes/${DENY}.md`]: "plain\nalso other-made-up-word here\n",
    });
    const found = problems(root, base);
    expect(found).toEqual([
      "[a path that matches the private denylist]: an added file's name matches the private denylist",
      "[a path that matches the private denylist]:2: matches the private denylist",
      "src/b.ts:2: matches the private denylist",
    ]);
    expect(found.join("\n").toLowerCase()).not.toContain(DENY);
  });

  it("exempts an allow-listed fixture from rules 1 and 2, never from the denylist", () => {
    const { root, base } = repo();
    commit(root, {
      "test/fixtures/codex-hooks/deep/stop.json": `{"session_id":"a","cwd":"/home/alice/p/"}\n`,
      "test/harness/recorded/s.jsonl": `{"transcript_path":"/Users/bob/t/"}\n`,
      "test/harness/recorded/nested/s.jsonl": `{"transcript_path":"/tmp/t"}\n`,
      "test/fixtures/codex-hooks/x.ts": `// ${DENY}\n`,
    });
    expect(problems(root, base)).toEqual([
      "test/fixtures/codex-hooks/x.ts:1: matches the private denylist",
      "test/harness/recorded/nested/s.jsonl:1: holds a recorded agent session log",
    ]);
  });

  it("names a path git quotes in its patch as it is", () => {
    const { root, base } = repo();
    commit(root, { 'src/we"ird\tnäme\\.ts': "const p = '/home/alice/x';\n" });
    expect(problems(root, base)).toEqual(['src/we"ird\tnäme\\.ts:1: holds an absolute home path']);
  });

  it("fails a home root with no slash and a non-ASCII name, and passes URLs and placeholders", () => {
    const { root, base } = repo();
    commit(root, {
      "src/b.ts": "cd /home/alice\nconst p = '/Users/zoë/x';\nconst q = \"/home/émile\";\n",
      "src/c.ts":
        "https://example.com/home/carol https://example.com/Users/zoë\n" +
        "/home/<you>/x /home/$USER/x /Users/{name}/x /home/%u ${HOME}\n" +
        "/home/user /home/runner /Users/user /home/squeal-e2e /home/\n",
    });
    expect(problems(root, base)).toEqual([
      "src/b.ts:1: holds an absolute home path",
      "src/b.ts:2: holds an absolute home path",
      "src/b.ts:3: holds an absolute home path",
    ]);
  });

  it("undoes JSON string escapes, nested up to three times, before each rule, never printing them", () => {
    const { root, base } = repo();
    const hook = { session_id: "abc", cwd: "/tmp/x" };
    const once = JSON.stringify({ input: JSON.stringify(hook) });
    const thrice = JSON.stringify({ a: JSON.stringify({ b: once }) });
    // Three rounds bound the work a line costs; a fourth nesting goes unread.
    const fourTimes = JSON.stringify({ a: thrice });
    commit(root, {
      "logs/a.json": `{"p":"\\/home\\/alice\\/x"}\n${once}\n${thrice}\n${fourTimes}\n`,
      "logs/b.json": `{"n":"secret\\u002dclient\\u002Drepo"}\n{"t":"\\\\u0022transcript_path\\\\u0022"}\n`,
      "logs/c.json": `${JSON.stringify({ a: '"session_id":1', b: '"cwd":2' }, null, 2)}\n`,
      "src/d.ts": "const s = 'a\\\\b \\\\/home/ \\\\u00';\n",
    });
    const found = problems(root, base);
    expect(found).toEqual([
      "logs/a.json:1: holds an absolute home path",
      "logs/a.json:2: holds a recorded agent session log",
      "logs/a.json:3: holds a recorded agent session log",
      "logs/b.json:1: matches the private denylist",
      "logs/b.json:2: holds a recorded agent session log",
      "logs/c.json:2: holds a recorded agent session log",
    ]);
    expect(found.join("\n").toLowerCase()).not.toContain(DENY);
  });

  it("reads a file name with a space and an upper-case .JSON suffix exactly", () => {
    const { root, base } = repo();
    const hook = `${JSON.stringify({ session_id: "abc", cwd: "/tmp/x" }, null, 2)}\n`;
    commit(root, {
      "logs/log name.json": hook,
      "logs/LOG.JSON": hook,
      "src/a b.ts": "const p = '/home/alice/x';\n",
    });
    expect(problems(root, base)).toEqual([
      "src/a b.ts:1: holds an absolute home path",
      "logs/LOG.JSON:2: holds a recorded agent session log",
      "logs/log name.json:2: holds a recorded agent session log",
    ]);
  });

  it("reads a text file an attribute marks binary as text, added whole or changed", () => {
    const { root, base } = repo();
    commit(root, {
      ".gitattributes": "*.txt -diff\n*.bin -diff\n",
      "doc.txt": "plain\n/home/alice/x\n",
      "real.bin": Buffer.from(`\0\0/home/alice/x\0 ${DENY}\n`),
    });
    expect(problems(root, base)).toEqual(["doc.txt:2: holds an absolute home path"]);
    const mid = git(root, ["rev-parse", "HEAD"]).trim();
    commit(root, { "doc.txt": `plain ${DENY}\n/home/alice/x\n`, "new.txt": "/Users/bob/y\n" });
    expect(problems(root, mid)).toEqual([
      "doc.txt:1: matches the private denylist",
      "new.txt:1: holds an absolute home path",
    ]);
    const last = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["mv", "doc.txt", "moved.txt"]);
    commit(root, { "moved.txt": `plain ${DENY}\n/home/alice/x\nend /home/bob\n` });
    expect(problems(root, last)).toEqual(["moved.txt:3: holds an absolute home path"]);
  });

  it("takes the merge-base with origin/main when no base is given", () => {
    const { root, base } = repo();
    commit(root, { "src/b.ts": "const p = '/Users/bob/x';\n" });
    expect(() => privateReport(root, undefined, DENY_ENV)).toThrow(
      /no merge-base with origin\/main/,
    );
    git(root, ["update-ref", "refs/remotes/origin/main", base]);
    expect(privateReport(root, undefined, DENY_ENV)).toMatchObject({
      base,
      problems: ["src/b.ts:1: holds an absolute home path"],
    });
  });

  it("skips binary files", () => {
    const { root, base } = repo();
    commit(root, { "a.bin": Buffer.from("\0\0/home/alice/x\0 secret-client-repo\n") });
    expect(problems(root, base)).toEqual([]);
  });

  it.each([
    ["refs/heads/main", true],
    ["refs/heads/cand/0.1.2", true],
    ["refs/heads/cand/011-336-r3", true],
    ["refs/heads/cez/abc", false],
    ["refs/heads/maintenance", false],
    ["refs/pull/7/merge", false],
    [undefined, false],
  ])("with no denylist on %s fails closed: %s", (ref, fails) => {
    const { root, base } = repo();
    commit(root, { "src/b.ts": `// ${DENY}\n` });
    for (const empty of [undefined, "", " \n \n"]) {
      const env = { SQUEAL_PRIVATE_DENYLIST: empty, GITHUB_REF: ref };
      const report = privateReport(root, base, env);
      expect(report.problems).toEqual(
        fails
          ? [`SQUEAL_PRIVATE_DENYLIST is empty; the private denylist must be set for ${ref}`]
          : [],
      );
      expect(report.warnings).toEqual(
        fails ? [] : ["SQUEAL_PRIVATE_DENYLIST is empty; the private denylist rule is skipped"],
      );
    }
  });
});

// Each test starts Node and several git commands; at host load over 100 that passed 5 s.
describe("scripts/check-private.ts as CI runs it", { timeout: 30_000 }, () => {
  const run = (root: string, args: string[], extra: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    for (const name of ["GITHUB_REF", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
      if (!(name in extra)) delete env[name];
    }
    if (!("SQUEAL_PRIVATE_DENYLIST" in extra)) delete env.SQUEAL_PRIVATE_DENYLIST;
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", SCRIPT, ...args],
      { cwd: root, encoding: "utf8", env },
    );
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };

  it("exits 1 with file:line and no denylist value, and 0 once the lines are gone", () => {
    const { root, base } = repo();
    commit(root, { [`src/${DENY}.ts`]: `// ${DENY}\nconst p = '/home/alice/x';\n` });
    const failed = run(root, [base], DENY_ENV);
    expect(failed.code).toBe(1);
    expect(failed.output).toContain("private: [a path that matches the private denylist]:2:");
    expect(failed.output.toLowerCase()).not.toContain(DENY);
    git(root, ["rm", "-q", `src/${DENY}.ts`]);
    commit(root, { "src/b.ts": "const p = '/home/user/x';\n" });
    expect(run(root, [base], DENY_ENV)).toEqual({
      code: 0,
      output: `private: 1 added lines in 1 files over ${base}, ok\n`,
    });
  });

  it("takes the merge-base with origin/main by default and ignores pnpm's --", () => {
    const { root, base } = repo();
    git(root, ["update-ref", "refs/remotes/origin/main", base]);
    commit(root, { "src/b.ts": "const p = '/Users/bob/x';\n" });
    const failed = run(root, ["--"], DENY_ENV);
    expect(failed).toEqual({
      code: 1,
      output: expect.stringContaining("private: src/b.ts:1: holds an absolute home path\n"),
    });
    expect(failed.output).toContain(`over ${base}`);
  });

  it("warns and passes without a denylist off main, and fails on main", () => {
    const { root, base } = repo();
    commit(root, { "src/b.ts": `// ${DENY}\n` });
    expect(run(root, [base])).toEqual({
      code: 0,
      output: expect.stringContaining("warning: SQUEAL_PRIVATE_DENYLIST is empty"),
    });
    expect(run(root, [base], { GITHUB_REF: "refs/heads/main" }).code).toBe(1);
  });
});
