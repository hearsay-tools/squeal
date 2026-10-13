import { describe, expect, it } from "vitest";
import { testCommandDenied } from "../../src/core/delivery/test-command-denied.js";
import { listTestFilesOf } from "../../src/core/scheduler/omitted-test-files.js";
import { RunnerPartBound } from "../../src/core/scheduler/runner-work-bound.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { openFixture, SLOW, TYPECHECKED } from "../runners/vitest/helpers.js";
import { check, result, setKey } from "../state/helpers.js";
import { codexRecorded, sessionOf } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Review wave-2 B1, task 005-26: the one-time deny (spec 005 D8) answers a
 * Vitest command only while the daemon's listing names every file the
 * command runs. The listing and its left-out count come from the real
 * Vitest adapter through the scheduler's listing call; both harnesses' hooks.
 */

const deps: HookDeps = {
  env: {},
  ensureDaemon: async () => "alive",
  command: 'node "/opt/codex/plugins/squeal/dist/cli/squeal.mjs"',
};

/** A worktree whose store holds `files` as the Vitest fixture `extra` lists them, each passing and current. */
async function listedFrom(extra: Readonly<Record<string, string>>): Promise<SquealRepo> {
  const fx = await openFixture("basic", extra);
  const r = squealRepo();
  const bound = new RunnerPartBound(60_000);
  const listing = await listTestFilesOf({ ...r, runner: fx.adapter }, bound);
  r.store.testFileKeys.remove(r.worktreeId, [FILE]);
  for (const [i, file] of listing.entries())
    setKey(r.store, `kp${i}`, { file, worktreeId: r.worktreeId });
  r.apply(
    ...listing.map((file: TestFileRef, i) =>
      result(check("works", file), "pass", { key: `kp${i}`, worktreeId: r.worktreeId }),
    ),
  );
  r.policy({ testCommand: { denyWhenCurrent: true } });
  return r;
}

async function claudeCode(r: SquealRepo): Promise<string> {
  await runHook("session-start", recorded("session-start", r.root), deps);
  const input = { tool_name: "Bash", tool_input: { command: "npx vitest run" } };
  return (await runHook("pre-tool-use", recorded("pre-tool-use", r.root, input), deps)).stdout;
}

async function codex(r: SquealRepo): Promise<string> {
  await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), deps);
  const input = {
    ...sessionOf("exec", "session-start"),
    tool_input: { command: "npx vitest run" },
  };
  const call = codexRecorded("exec", "pre-tool-use", r.root, input);
  return (await runCodexHook("pre-tool-use", call, deps)).stdout;
}

const consumerOf = (r: SquealRepo) => {
  const consumer = r.store.consumers.list(r.worktreeId)[0]?.consumer;
  if (consumer === undefined) throw new Error("no consumer registered");
  return consumer;
};

describe("the one-time deny against a listing that leaves files out (review wave-2 B1)", () => {
  for (const [harness, call] of [
    ["Claude Code", claudeCode],
    ["Codex", codex],
  ] as const) {
    it(`${harness}: runs a suite with typecheck files, its once slot unused`, SLOW, async () => {
      const r = await listedFrom(TYPECHECKED);
      expect(r.store.testFileKeys.list(r.worktreeId)).toHaveLength(4);
      expect(await call(r)).toBe("");
      expect(testCommandDenied(r.store, consumerOf(r))).toBe(false);
    });

    it(`${harness}: denies a suite it lists completely, once`, SLOW, async () => {
      const r = await listedFrom({});
      const denied = await call(r);
      expect(denied).toContain('"permissionDecision":"deny"');
      expect(denied).toContain("for the 4 test files it runs");
      expect(testCommandDenied(r.store, consumerOf(r))).toBe(true);
      expect(await call(r)).toBe("");
    });
  }
});
