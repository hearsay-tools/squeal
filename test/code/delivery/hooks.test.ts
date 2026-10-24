import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import { seededKey } from "../../../src/core/delivery/code-deliver.js";
import { type HookDeps, runHook } from "../../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../../src/harness/codex/index.js";
import { codexRecorded, sessionOf } from "../../harness/codex/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "../../harness/helpers.js";
import { ON } from "../helpers.js";
import { codeState, codeTransition, fn, fnCheck, putFile, TIERS } from "./helpers.js";

/*
 * Spec 015 Testing, integration: a fixture repository with the policy on,
 * a function edited over the threshold, the delivery read from the Claude
 * Code hook and from the Codex hook. The code store rows are the ones the
 * daemon's pass (015-06) writes.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const SELECT = fnCheck("selectTier");
const FAIL_LINE =
  "FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23, over 20 (ESLint rule)";

function withCode(complexity: object = { enabled: true }): { r: SquealRepo; code: CodeStore } {
  const r = squealRepo();
  r.apply(r.pass());
  writeFileSync(join(r.root, "squeal.config.json"), JSON.stringify({ complexity }));
  const code = openCodeStore(r.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  putFile(code, r.worktreeId, TIERS, [fn("selectTier", 18, 120)]);
  code.states.upsertMany([codeState(r.worktreeId, SELECT, 18)]);
  return { r, code };
}

/** The daemon's pass over an edit that takes `selectTier` from 18 to 23. */
function overTheThreshold({ r, code }: { r: SquealRepo; code: CodeStore }) {
  r.apply();
  putFile(code, r.worktreeId, TIERS, [fn("selectTier", 23, 120)]);
  code.states.upsertMany([codeState(r.worktreeId, SELECT, 23, { revision: 2 })]);
  code.transitions.append([
    codeTransition(r.worktreeId, SELECT, "pass-to-fail", {
      from: 18,
      to: 23,
      at: Date.now() + 1_000,
      revision: 2,
    }),
  ]);
}

const contextOf = (stdout: string): string => {
  const out = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
  return out.hookSpecificOutput?.additionalContext ?? "";
};

describe("complexity through the Claude Code hook (015 D6, D7)", () => {
  it("registers with the count and delivers the edit's FAIL line", async () => {
    const repo = withCode();
    const start = await runHook("session-start", recorded("session-start", repo.r.root), deps);
    expect(contextOf(start.stdout)).toContain(
      "\nComplexity: 0 functions over 20; squeal code lists them.",
    );
    overTheThreshold(repo);
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", repo.r.root), deps);
    expect(contextOf(batch.stdout).split("\n")).toContain(FAIL_LINE);
    // Goal 7: without complexity.blocking a Stop says nothing more.
    expect((await runHook("stop", recorded("stop", repo.r.root), deps)).stdout).toBe("");
  });

  it("blocks Stop on a function gone over since registration with complexity.blocking", async () => {
    const repo = withCode({ enabled: true, blocking: true });
    await runHook("session-start", recorded("session-start", repo.r.root), deps);
    overTheThreshold(repo);
    const stop = await runHook("stop", recorded("stop", repo.r.root), deps);
    const out = JSON.parse(stop.stdout) as { decision?: string; reason?: string };
    expect(out.decision).toBe("block");
    expect(out.reason).toContain(
      "Squeal policy complexity.blocking is on and 1 function went over the complexity threshold 20 since this session started: selectTier (src/core/scheduler/tiers.ts:120).",
    );
  });

  it("never blocks Stop on a function already over at registration", async () => {
    const repo = withCode({ enabled: true, blocking: true });
    overTheThreshold(repo);
    await runHook("session-start", recorded("session-start", repo.r.root), deps);
    const stop = await runHook("stop", recorded("stop", repo.r.root), deps);
    expect(stop.stdout).toBe("");
  });
});

describe("code views end with the session (lessons round 1, P5)", () => {
  it("drops the session's views and told marks at SessionEnd, and those of a consumer that left", async () => {
    const repo = withCode();
    overTheThreshold(repo);
    const { r, code } = repo;
    await runHook("session-start", recorded("session-start", r.root), deps);
    const session = r.consumer();
    const left = { ...session, sessionId: "gone-without-a-session-end" };
    code.views.writeMany(left, code.views.list(session));
    expect(code.views.list(session)).toHaveLength(1);
    expect(code.meta.get(seededKey(session))).not.toBeNull();
    await runHook("session-end", recorded("session-end", r.root), deps);
    expect(code.views.list(session)).toEqual([]);
    expect(code.views.list(left)).toEqual([]);
    expect(code.meta.get(seededKey(session))).toBeNull();
  });
});

describe("complexity through the Codex hook (015 D6)", () => {
  it("registers with the count and delivers the edit's FAIL line", async () => {
    const repo = withCode();
    const session = sessionOf("exec", "post-tool-use");
    const start = await runCodexHook(
      "session-start",
      codexRecorded("exec", "session-start", repo.r.root, session),
      deps,
    );
    expect(start.stdout).toContain("Complexity: 0 functions over 20;");
    overTheThreshold(repo);
    const tool = await runCodexHook(
      "post-tool-use",
      codexRecorded("exec", "post-tool-use", repo.r.root),
      deps,
    );
    expect(contextOf(tool.stdout).split("\n")).toContain(FAIL_LINE);
  });
});
