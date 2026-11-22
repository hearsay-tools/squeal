import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { runHook } from "./.runtime/source/src/harness/claude-code/hooks.js";
import { check, result, setKey } from "./.runtime/source/test/state/helpers.js";
import { appendRevisions } from "./.runtime/source/test/status/helpers.js";
import { squealRepo } from "./.runtime/source/test/harness/helpers.js";

const files = ["test/alpha.test.ts", "test/beta.test.ts", "test/gamma.test.ts"]
  .map((path) => ({ project: "", path }));
const checks = files.map((file, i) => check(`regression ${i + 1}`, file));
const content = "x".repeat(16_384);
const deps = { env: { SQUEAL_HOOK_DEBUG: "1" }, ensureDaemon: async () => "alive" as const };

async function fixture() {
  const r = squealRepo();
  r.policy({ interrupt: { onRegression: true } });
  files.forEach((file) => setKey(r.store, "passing", { file, worktreeId: r.worktreeId }));
  r.apply(...checks.map((c) => result(c, "pass", { key: "passing", worktreeId: r.worktreeId })));
  const base = { session_id: "issue-263-synthetic", cwd: r.root };
  const started = await runHook("session-start", JSON.stringify({ ...base, hook_event_name: "SessionStart", source: "startup" }), deps);
  expect(started.stderr).toBe("");
  expect(started.stdout).toContain("SQUEAL");
  appendRevisions(r.store, r.worktreeId, 12, { head: null, dirty: true });
  let revision = 13;
  const input = JSON.stringify({ ...base, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: `${r.root}/src/refactor.ts`, content } });
  return {
    r,
    async write() {
      const out = await runHook("pre-tool-use", input, deps);
      expect(out.stderr).toBe("");
      expect(out.exitCode).toBe(0);
      const parsed = out.stdout ? JSON.parse(out.stdout) : null;
      return { denied: parsed?.hookSpecificOutput?.permissionDecision === "deny", reason: parsed?.hookSpecificOutput?.permissionDecisionReason ?? "" };
    },
    fail(indices: number[], nextRevision = false) {
      if (nextRevision) {
        appendRevisions(r.store, r.worktreeId, 1, { head: null, dirty: true });
        revision++;
      }
      const results = indices.map((i) => {
        setKey(r.store, `failed-${i}`, { file: files[i], worktreeId: r.worktreeId });
        return result(checks[i], "fail", { key: `failed-${i}`, worktreeId: r.worktreeId, revision, message: `expected batch ${i + 1} to pass` });
      });
      r.store.transaction(() => r.store.results.putMany(results));
      r.sink.applyResults(r.worktreeId, revision, results, { checkpointId: null });
    },
  };
}

describe("issue 263: synthetic Claude Code Write boundaries on 0.1.591", () => {
  it("the same regression denies once", async () => {
    const f = await fixture();
    f.fail([0]);
    const calls = [await f.write(), await f.write(), await f.write()];
    expect(calls.map((c) => c.denied)).toEqual([true, false, false]);
    console.log("same regression: deny, allow, allow");
  });

  it.each([false, true])("new batches deny consecutive identical writes; revision changes=%s", async (advance) => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) {
      f.fail([i], advance && i === 1);
      const call = await f.write();
      expect(call.denied).toBe(true);
      expect(call.reason).toContain(files[i].path);
      expect(call.reason).toContain("this regression does not deny again");
      for (let prior = 0; prior < i; prior++) expect(call.reason).not.toContain(files[prior].path);
    }
    expect((await f.write()).denied).toBe(false);
    console.log(`new batches, revisions ${advance ? "13/14/14" : "13/13/13"}: deny alpha, deny beta, deny gamma, allow; identical content bytes=${Buffer.byteLength(content)}`);
  });

  it("all regressions available together deny one write", async () => {
    const f = await fixture();
    f.fail([0, 1, 2]);
    const first = await f.write();
    expect(first.denied).toBe(true);
    for (const file of files) expect(first.reason).toContain(file.path);
    expect((await f.write()).denied).toBe(false);
    console.log("one batch containing alpha/beta/gamma: deny all, allow");
  });

  it("policy off permits the write while failed states remain", async () => {
    const f = await fixture();
    f.fail([0]);
    f.r.policy({ interrupt: { onRegression: false } });
    expect((await f.write()).denied).toBe(false);
    expect(f.r.store.knownStates.list(f.r.worktreeId).filter((s) => s.outcome === "fail")).toHaveLength(1);
    console.log("interrupt.onRegression=false: allow; failed states=1");
  });
});
