import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { readStatus } from "../../src/core/status/index.js";
import { rootVersion } from "../../src/harness/claude-code/build.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { seedLogin as seedWhyLogin } from "../status/why-seed.js";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

function run(argv: string[], cwd: string, env: CliIo["env"] = {}) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    now: () => NOW,
    // A Codex shell's CODEX_SESSION_ID would add a line to status (spec 002 D6).
    env,
  };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

/** Worktree `b` inherited `auth > login` from run `run-a1`, whose log is written. */
function seedLogin() {
  const repo = fakeRepo();
  const b = seedWhyLogin(repo, seedStore(repo));
  const runDir = join(repo.commonDir, "squeal", "runs", "run-a1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "vitest.log"),
    "[stdout] src/auth.test.ts: logging in\n[stdout] src/other.test.ts: other file\n",
  );
  return { ...repo, b };
}

function seededRepo() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  appendRevisions(store, repo.mainId, 3, { head: null, dirty: false });
  store.knownStates.upsertMany([
    state(repo.mainId, check("src/a.test.ts", "adds"), {
      outcome: "fail",
      summary: "expected 3, received 4",
      fingerprint: "AssertionError: expected 3, received 4",
      observedAt: 3,
    }),
  ]);
  return repo;
}

describe("squeal status", () => {
  it("prints the human status and exits 0", () => {
    const repo = seededRepo();

    const { code, stdout, stderr } = run(["status"], repo.main);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.split("\n").slice(0, 7)).toEqual([
      "Revision: 3",
      "Known failures: 1",
      "  FAIL  src/a.test.ts > adds",
      "        expected 3, received 4",
      "        observed at revision 3, current",
      "Affected checks: none counted; the daemon has not listed this worktree's test files yet",
      "Full-suite checkpoint: none completed at any revision (the counts are for revision 3; `squeal run --all` requests one)",
    ]);
  });

  it("names the Codex command in a Codex shell, where squeal is not on the PATH (defect 27)", () => {
    const repo = seededRepo();
    const env = { CODEX_SESSION_ID: "thread-1", PLUGIN_ROOT: "/opt/codex/squeal" };

    const { stdout } = run(["status"], repo.main, env);

    const command =
      'node --disable-warning=ExperimentalWarning "/opt/codex/squeal/dist/cli/squeal.mjs"';
    expect(stdout).toContain(
      `Full-suite checkpoint: none completed at any revision (the counts are for revision 3; \`${command} run --all\` requests one)`,
    );
    expect(stdout).not.toMatch(/`squeal /);
  });

  it("emits the versioned snapshot with --json", () => {
    const repo = seededRepo();

    const { code, stdout } = run(["status", "--json"], repo.main);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(readStatus(repo.main, { now: () => NOW }));
    expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, available: true, revision: 3 });
  });

  it("reports an unavailable status on stdout and exits 1", () => {
    const repo = fakeRepo();

    const human = run(["status"], repo.main);
    const json = run(["status", "--json"], repo.main);

    expect(human.code).toBe(1);
    expect(human.stdout).toMatch(/^Status unavailable, no Squeal store at /);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ available: false, reason: "no-store" });
  });

  it("rejects unknown options", () => {
    const { code, stderr } = run(["status", "--yaml"], fakeRepo().main);

    expect(code).toBe(2);
    expect(stderr).toContain('squeal status: unknown option "--yaml"');
  });
});

describe("squeal why", () => {
  it("prints the history of one check", () => {
    const repo = seededRepo();

    const { code, stdout } = run(["why", "src/a.test.ts > adds"], repo.main);

    expect(code).toBe(0);
    expect(stdout).toContain("Check: src/a.test.ts > adds\n");
    expect(stdout).toContain("Known state: FAIL, current, observed at revision 3\n");
  });

  it("emits the report with --json, before or after the name", () => {
    const repo = seededRepo();

    const after = run(["why", "adds", "--json"], repo.main);
    const before = run(["why", "--json", "adds"], repo.main);

    expect(after.code).toBe(0);
    expect(JSON.parse(after.stdout)).toMatchObject({
      schemaVersion: 1,
      found: true,
      check: check("src/a.test.ts", "adds"),
    });
    expect(before.stdout).toBe(after.stdout);
  });

  it("prints the check's console lines from its run log with --include-logs", () => {
    const repo = seedLogin();

    const plain = run(["why", "auth > login"], repo.b.root);
    const logs = run(["why", "--include-logs", "auth > login"], repo.b.root);

    expect(plain.stdout).toContain("--include-logs prints the console lines of src/auth.test.ts");
    expect(plain.stdout).not.toContain("logging in");
    expect(logs.code).toBe(0);
    expect(logs.stdout).toContain(
      "Console of src/auth.test.ts in this log (1 line):\n  [stdout] src/auth.test.ts: logging in\n",
    );
    expect(logs.stdout).not.toContain("other file");
  });

  it("exits 1 when no check matches", () => {
    const repo = seededRepo();

    const { code, stdout } = run(["why", "nope"], repo.main);

    expect(code).toBe(1);
    expect(stdout).toBe('No check matches "nope" in this worktree.\n');
  });

  it("needs exactly one check name", () => {
    const repo = seededRepo();

    expect(run(["why"], repo.main)).toMatchObject({ code: 2 });
    expect(run(["why", "a", "b"], repo.main).stderr).toContain(
      "squeal why: expected one check name",
    );
  });
});

describe("squeal", () => {
  it("lists status and why in the help", () => {
    const { code, stdout } = run(["--help"], fakeRepo().main);

    expect(code).toBe(0);
    expect(stdout).toContain("squeal status [--notes] [--json]");
    expect(stdout).toContain("squeal why <check> [--include-logs] [--json]");
  });

  it("still prints the version", () => {
    const { code, stdout } = run(["--version"], fakeRepo().main);

    expect(code).toBe(0);
    expect(stdout).toBe(`${rootVersion()}\n`);
  });
});
