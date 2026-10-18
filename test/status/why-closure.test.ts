import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { tellRegistered } from "../../src/core/delivery/registered.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { Consumer, Store } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";
import { reportOf } from "./why-seed.js";

const LOGIN = check("src/auth.test.ts", "auth > login");
const NAME = "src/auth.test.ts > auth > login";

function revision(store: Store, worktreeId: string, paths: readonly string[]): number {
  return store.revisions.append({
    worktreeId,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: "h0", newHash: "h1" })),
  }).number;
}

/** `auth > login` fails after session `s1` registered and edited `src/auth.ts`, which its test imports. */
function seed(outcome: "fail" | "pass" = "fail") {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.testFiles.put({
    testFile: { project: LOGIN.project, path: LOGIN.testPath },
    closure: {
      testFile: { project: LOGIN.project, path: LOGIN.testPath },
      paths: ["src/auth.test.ts", "src/auth.ts"],
      complete: false,
      method: "static imports plus declared inputs",
    },
    updatedAt: 1,
    updatedBy: repo.mainId,
  });
  const consumer: Consumer = { worktreeId: repo.mainId, sessionId: "s1", agentId: "main" };
  store.consumers.register(consumer, 1);
  tellRegistered(store, consumer, revision(store, repo.mainId, ["README.md"]), {
    at: 1,
    scanned: null,
  });
  const at = revision(store, repo.mainId, ["src/auth.ts"]);
  store.knownStates.upsertMany([state(repo.mainId, LOGIN, { outcome, observedAt: at })]);
  return repo;
}

/* 011 C5 as amended (gh-32, task 011-18): `why` names the closure paths the shell's session changed. */
describe("squeal why, the closure line", () => {
  it("names the closure paths changed since the shell's session registered", () => {
    const repo = seed();
    const why = reportOf(readWhy(repo.main, NAME, { session: { session: "s1", agent: null } }));
    expect(why.changesInClosure).toEqual(["src/auth.ts"]);
    expect(formatWhy(why)).toContain(
      "  Its closure reads files changed here since this session started: src/auth.ts",
    );
  });

  it("is absent outside a registered session, and for a passing check", () => {
    const repo = seed();
    expect(reportOf(readWhy(repo.main, NAME)).changesInClosure).toBeUndefined();
    const other = { session: { session: "s2", agent: null } };
    expect(reportOf(readWhy(repo.main, NAME, other)).changesInClosure).toBeUndefined();
    const passing = seed("pass");
    const s1 = { session: { session: "s1", agent: null } };
    expect(formatWhy(reportOf(readWhy(passing.main, NAME, s1)))).not.toContain("Its closure");
  });
});

describe("squeal why in a harness shell (011-18)", () => {
  /** `squeal why NAME`'s stdout in a shell whose environment is `env`. */
  function why(cwd: string, env: Record<string, string>): string {
    let stdout = "";
    main(["why", NAME], { stdout: (t) => (stdout += t), stderr: () => {}, cwd, env });
    return stdout;
  }

  it.each([
    ["Claude Code", { CLAUDE_CODE_SESSION_ID: "s1" }],
    ["Codex", { CODEX_SESSION_ID: "s1" }],
    ["Pi", { PI_SESSION_ID: "s1" }],
  ])("reads the session from a %s shell", (_harness, env) => {
    const repo = seed();
    expect(why(repo.main, env)).toContain("  Its closure reads files changed here");
    expect(why(repo.main, {})).not.toContain("Its closure");
  });
});
