import { describe, expect, it } from "vitest";
import {
  type Consumer,
  MAIN_AGENT,
  type PolicyFile,
  refinedMetaKey,
} from "../../../src/core/types/index.js";
import { runCodexHook } from "../../../src/harness/codex/index.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { rootKey, sessionRootFiles } from "../../../src/harness/shared/session-root.js";
import { tempDir } from "../../store/helpers.js";
import type { SquealRepo } from "../helpers.js";
import { decision, deps, HARNESSES, landSlow, repo } from "../stop-slow-helpers.js";
import { codexInput, codexRecorded } from "./helpers.js";

/*
 * Row 019-05, spec 004 D7 ("a SubagentStop blocks"): a Codex SubagentStop
 * takes the subagent path of `stopTurn`, as Claude Code's does. It waits up
 * to `stop.waitMs` for pending fast checks, blocks once while a required
 * check is not current, never again with `stop_hook_active`, and otherwise
 * unregisters the subagent and says nothing. A block keeps the subagent's
 * root for its next hooks (spec 001 D9, task 001-415).
 */

const CODEX = HARNESSES.find((h) => h.name === "codex");
const SILENT = { stdout: "", stderr: "" };
const SLOW_REASON =
  /^Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 1: test\/e2e\/slow.test.ts. `.*squeal.* run --slow --wait` runs them and waits for their results.\n\n/;
const START = codexInput("exec", "subagent-start", "/");

function consumer(r: SquealRepo, agentId: string): Consumer {
  return { worktreeId: r.worktreeId, sessionId: String(START.session_id), agentId };
}
const subagent = (r: SquealRepo) => consumer(r, String(START.agent_id));
const KEY = rootKey({ session_id: String(START.session_id), agent_id: String(START.agent_id) });

/** Hook deps that keep each thread's root between hooks, as the bundles do. */
function rooted() {
  const roots = sessionRootFiles({ XDG_RUNTIME_DIR: tempDir("squeal-codex-subagent-stop-") });
  return { roots, deps: { ...deps, sessionRoots: roots } satisfies HookDeps };
}

const subagentStop = (r: SquealRepo, overrides: object = {}, hookDeps: HookDeps = deps) =>
  runCodexHook(
    "subagent-stop",
    codexRecorded("exec", "subagent-stop", r.root, overrides),
    hookDeps,
  );

/** The main agent in a turn at revision 1, the slow file queued there, and a registered subagent. */
async function withSubagent(
  stop: NonNullable<PolicyFile["stop"]>,
  hookDeps: HookDeps = deps,
): Promise<SquealRepo> {
  if (CODEX === undefined) throw new Error("no codex harness");
  const r = await repo(CODEX, stop, false);
  await runCodexHook("subagent-start", codexRecorded("exec", "subagent-start", r.root), hookDeps);
  expect(r.store.consumers.get(subagent(r))).not.toBeNull();
  return r;
}

describe("Codex SubagentStop under stop.requireSlowSuite (row 019-05, spec 004 D7)", () => {
  it("blocks once while a slow file is not current, then ends the subagent", async () => {
    const { roots, deps: hookDeps } = rooted();
    const r = await withSubagent({ requireSlowSuite: true }, hookDeps);
    expect(roots.get(KEY)?.root).toBe(r.root);
    const out = decision(await subagentStop(r, {}, hookDeps));
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(SLOW_REASON);
    // The block keeps the subagent going, so its registration and root stay.
    expect(r.store.consumers.get(subagent(r))).not.toBeNull();
    expect(roots.get(KEY)?.root).toBe(r.root);

    expect(await subagentStop(r, { stop_hook_active: true }, hookDeps)).toEqual(SILENT);
    expect(r.store.consumers.get(subagent(r))).toBeNull();
    expect(roots.get(KEY)).toBeNull();
    expect(r.store.consumers.get(consumer(r, MAIN_AGENT))).not.toBeNull();
  });

  it("stays silent and unregisters the subagent when every slow file is current", async () => {
    const { roots, deps: hookDeps } = rooted();
    const r = await withSubagent({ requireSlowSuite: true }, hookDeps);
    landSlow(r, "pass");
    expect(await subagentStop(r, {}, hookDeps)).toEqual(SILENT);
    expect(r.store.consumers.get(subagent(r))).toBeNull();
    expect(roots.get(KEY)).toBeNull();
    expect(r.store.consumers.get(consumer(r, MAIN_AGENT))).not.toBeNull();
  });

  it("waits up to stop.waitMs for pending fast work before it decides", async () => {
    const r = await withSubagent({ requireSlowSuite: true, waitMs: 1_000 });
    const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
    // The runner has not looked at this revision yet, so fast work is pending.
    r.store.meta.set(refinedMetaKey(r.worktreeId), String(revision - 1));
    const refined = setTimeout(
      () => r.store.meta.set(refinedMetaKey(r.worktreeId), String(revision)),
      300,
    );
    try {
      const started = performance.now();
      const out = decision(await subagentStop(r));
      expect(performance.now() - started).toBeGreaterThanOrEqual(290);
      expect(out.decision).toBe("block");
      expect(out.reason).toMatch(SLOW_REASON);
    } finally {
      clearTimeout(refined);
    }
  });
});

describe("Codex SubagentStop without a block (row 019-05)", () => {
  it("says nothing about news it does not block on, and leaves the parent's view", async () => {
    const r = await withSubagent({});
    r.apply(r.fail());
    expect(await subagentStop(r)).toEqual(SILENT);
    expect(r.store.consumers.get(subagent(r))).toBeNull();
    const parent = await runCodexHook(
      "post-tool-use",
      codexRecorded("exec", "post-tool-use", r.root),
      deps,
    );
    expect(parent.stdout).toContain("PASS -> FAIL");
  });

  it("registers nothing, ensures no daemon and never blocks for an unregistered subagent", async () => {
    if (CODEX === undefined) throw new Error("no codex harness");
    const r = await repo(CODEX, { requireSlowSuite: true }, false);
    let ensured = 0;
    const counting: HookDeps = {
      ...deps,
      ensureDaemon: async () => {
        ensured++;
        return "alive";
      },
    };
    expect(await subagentStop(r, {}, counting)).toEqual(SILENT);
    expect(ensured).toBe(0);
    expect(r.store.consumers.get(subagent(r))).toBeNull();
  });

  it("is silent for an input with no agent_id", async () => {
    const r = await withSubagent({ requireSlowSuite: true });
    const input = codexInput("exec", "subagent-stop", r.root);
    delete input.agent_id;
    expect(await runCodexHook("subagent-stop", JSON.stringify(input), deps)).toEqual(SILENT);
  });
});
