import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testCommandDenied } from "../../src/core/delivery/test-command-denied.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { check, result, setKey } from "../state/helpers.js";
import { recorded, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Spec 005 D8: with `testCommand.denyWhenCurrent` on, an agent's first test
 * command whose every test file has a current result is denied once, its
 * reason the results; anything else, and every later command, runs.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const OTHER: TestFileRef = { project: "", path: "test/other.test.ts" };
const ON = { testCommand: { denyWhenCurrent: true } };

const bash = (command: string, overrides: object = {}) => ({
  tool_name: "Bash",
  tool_input: { command },
  ...overrides,
});

const preToolUse = (r: SquealRepo, overrides: object) =>
  runHook("pre-tool-use", recorded("pre-tool-use", r.root, overrides), deps);

/** The deny's reason, or `null` when the call runs. */
async function reasonOf(r: SquealRepo, overrides: object): Promise<string | null> {
  const out = await preToolUse(r, overrides);
  if (out.stdout === "") return null;
  const parsed = JSON.parse(out.stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

/** Registered, `math > adds` passing and current, `OTHER` keyed and passing too; the policy on. */
async function answered(policy: object = ON): Promise<SquealRepo> {
  const r = squealRepo();
  setKey(r.store, "k9", { file: OTHER, worktreeId: r.worktreeId });
  r.apply(r.pass(), result(check("other > works", OTHER), "pass", { key: "k9" }));
  r.policy(policy);
  await runHook("session-start", recorded("session-start", r.root), deps);
  return r;
}

describe("the one-time deny of a test command Squeal has answered (spec 005 D8)", () => {
  it("denies the first test command whose every file is current, with the results", async () => {
    const r = await answered();
    const reason = await reasonOf(r, bash("npx vitest run math"));
    expect(reason).toBe(
      "The command did not run. Squeal holds current results at revision 1 for the 1 test file " +
        "it runs (src/math.test.ts): 1 check passed, no known failures, none inherited.\n" +
        "Squeal does not cover typecheck, build, or test suites it is not configured for. " +
        "Run the command again to run it anyway; it will not be stopped again this session.",
    );
    expect(testCommandDenied(r.store, r.consumer())).toBe(true);
  });

  it("names only the command's files, and every known failure among them in full", async () => {
    const r = squealRepo();
    setKey(r.store, "k9", { file: OTHER, worktreeId: r.worktreeId });
    r.apply(r.fail(), result(check("other > works", OTHER), "fail", { key: "k9" }));
    r.policy(ON);
    await runHook("session-start", recorded("session-start", r.root), deps);
    const reason = await reasonOf(r, bash("vitest run src/math.test.ts"));
    expect(reason).toContain("for the 1 test file it runs (src/math.test.ts): 0 checks passed");
    expect(reason).toContain("1 known failure, none inherited.");
    expect(reason).toContain(
      "  FAIL  src/math.test.ts > math > adds\n        expected 3 to be 4\n        at src/a.ts:3:5\n",
    );
    expect(reason).not.toContain("other");
  });

  it("runs every later test command of the same consumer", async () => {
    const r = await answered();
    expect(await reasonOf(r, bash("npx vitest run"))).not.toBeNull();
    expect(await preToolUse(r, bash("npx vitest run"))).toEqual(SILENT);
    expect(await preToolUse(r, bash("vitest run math"))).toEqual(SILENT);
  });

  it("denies a subagent once on its own", async () => {
    const r = await answered();
    expect(await reasonOf(r, bash("npx vitest run"))).not.toBeNull();
    await runHook("session-start", recorded("subagent-start", r.root), deps);
    const sub = { agent_id: SUBAGENT, agent_type: "general-purpose" };
    expect(await reasonOf(r, bash("npx vitest run", sub))).not.toBeNull();
    expect(await preToolUse(r, bash("npx vitest run", sub))).toEqual(SILENT);
  });

  it("is off by default", async () => {
    const r = await answered({});
    expect(await preToolUse(r, bash("npx vitest run"))).toEqual(SILENT);
    expect(testCommandDenied(r.store, r.consumer())).toBe(false);
  });

  it("runs a command one of whose files is pending", async () => {
    const r = await answered();
    r.queue("k2");
    expect(await preToolUse(r, bash("npx vitest run"))).toEqual(SILENT);
    expect(await reasonOf(r, bash("npx vitest run other"))).not.toBeNull();
  });

  it("runs a command one of whose files has no result", async () => {
    const r = await answered();
    setKey(r.store, "k7", {
      file: { project: "", path: "test/new.test.ts" },
      worktreeId: r.worktreeId,
    });
    expect(await preToolUse(r, bash("npx vitest run"))).toEqual(SILENT);
    expect(await preToolUse(r, bash("npx vitest run new"))).toEqual(SILENT);
    expect(testCommandDenied(r.store, r.consumer())).toBe(false);
  });

  it("runs a command with a filter that matches no listed file", async () => {
    const r = await answered();
    expect(await preToolUse(r, bash("npx vitest run math nomatch"))).toEqual(SILENT);
  });

  it("runs a command that is not recognized", async () => {
    const r = await answered();
    expect(await preToolUse(r, bash("npx vitest run -t adds"))).toEqual(SILENT);
    expect(await preToolUse(r, bash("npx vitest run && echo ok"))).toEqual(SILENT);
    expect(await preToolUse(r, bash("ls"))).toEqual(SILENT);
  });

  it("runs while no daemon is validating", async () => {
    const r = await answered();
    r.daemon("stale");
    expect(await preToolUse(r, bash("npx vitest run"))).toEqual(SILENT);
  });

  it("runs from a working directory other than the worktree root", async () => {
    const r = await answered();
    const out = await runHook(
      "pre-tool-use",
      JSON.stringify({
        ...JSON.parse(recorded("pre-tool-use", `${r.root}/src`)),
        ...bash("npx vitest run"),
      }),
      deps,
    );
    expect(out).toEqual(SILENT);
  });

  it("denies from a working directory that reaches the root through a symlink", async () => {
    const r = await answered();
    const link = join(mkdtempSync(join(tmpdir(), "sq-link-")), "root");
    symlinkSync(r.root, link);
    const out = await runHook(
      "pre-tool-use",
      JSON.stringify({ ...JSON.parse(recorded("pre-tool-use", link)), ...bash("npx vitest run") }),
      deps,
    );
    expect(out.stdout).toContain('"permissionDecision":"deny"');
  });

  it("runs for a consumer without a registration", async () => {
    const r = await answered();
    expect(await preToolUse(r, bash("npx vitest run", { session_id: "other-session" }))).toEqual(
      SILENT,
    );
  });

  it("names the files by directory past ten", async () => {
    const r = await answered();
    const files = Array.from({ length: 11 }, (_, i) => ({
      project: "",
      path: `test/many/m${i}.test.ts`,
    }));
    for (const [i, file] of files.entries())
      setKey(r.store, `km${i}`, { file, worktreeId: r.worktreeId });
    r.apply(...files.map((file, i) => result(check("m > works", file), "pass", { key: `km${i}` })));
    const reason = await reasonOf(r, bash("npx vitest run many"));
    expect(reason).toContain("for the 11 test files it runs (test/many/ (11)): 11 checks passed");
  });
});
