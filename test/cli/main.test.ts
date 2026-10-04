import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { readStatus } from "../../src/core/status/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

function run(argv: string[], cwd: string) {
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
  };
  const code = main(argv, io);
  return { code, stdout, stderr };
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
      "Affected checks: 0 passed, 0 running, 0 queued",
      "Last full suite: none recorded",
    ]);
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
    expect(stdout).toContain("squeal status [--json]");
    expect(stdout).toContain("squeal why <check> [--json]");
  });

  it("still prints the version", () => {
    const { code, stdout } = run(["--version"], fakeRepo().main);

    expect(code).toBe(0);
    expect(stdout).toBe("0.0.0\n");
  });
});
