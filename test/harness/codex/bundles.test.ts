import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storePaths } from "../../../src/core/store/index.js";
import { CODEX_HOOKS, type CodexHookName } from "../../../src/harness/codex/index.js";
import { tempDir } from "../../store/helpers.js";
import { liveSocket, outsideGit, quietCli, runBundle, runtimeDir } from "../bundle-helpers.js";
import { SUBTRACTS, squealRepo } from "../helpers.js";
import { buildCodexBundles, codexInput, codexRecorded, type Mode } from "./helpers.js";

/*
 * Spec 002 goal 7 and D3 on the bundles: built into a directory of their own
 * (plugins/codex/dist is built at integration), run as hooks.json runs them,
 * recorded `codex exec` JSON in.
 */

const HOOKS = Object.keys(CODEX_HOOKS) as CodexHookName[];
/**
 * The recorded fixture each bundle reads: `codex exec`'s, but Interrupt, which
 * `exec` never fires, from an app-server `turn/interrupt` in the exec session.
 */
const FIXTURE: Record<CodexHookName, readonly [Mode, string]> = {
  "session-start": ["exec", "session-start"],
  "user-prompt-submit": ["exec", "user-prompt-submit"],
  "pre-tool-use": ["exec", "pre-tool-use"],
  "post-tool-use": ["exec", "post-tool-use"],
  stop: ["exec", "stop"],
  "subagent-start": ["exec", "subagent-start"],
  "subagent-stop": ["exec", "subagent-stop"],
  interrupt: ["app-server", "interrupt"],
  "session-end": ["exec", "session-end"],
};
const SESSION = String(codexInput("exec", "session-start", "/").session_id);

let dist = "";
let cleanup = () => {};
beforeAll(async () => {
  ({ dir: dist, cleanup } = await buildCodexBundles());
}, 60_000);
afterAll(() => cleanup());

function bundle(name: CodexHookName, cwd: string, env: Record<string, string> = {}) {
  const [mode, fixture] = FIXTURE[name];
  const input = codexRecorded(mode, fixture, cwd, { session_id: SESSION });
  return runBundle(name, input, env, dist);
}

describe("bundled Codex hooks without a usable store", () => {
  it.each(HOOKS)("%s exits 0 silently outside any git worktree", async (name) => {
    const out = await bundle(name, outsideGit());
    expect(out).toMatchObject({ stdout: "", stderr: "", code: 0 });
  });

  it.each(HOOKS)(
    "%s exits 0 silently with no store and no config, spawning nothing",
    async (name) => {
      const root = tempDir();
      mkdirSync(join(root, ".git"));
      writeFileSync(join(root, ".git/HEAD"), "ref: refs/heads/main\n");
      const { cli, ran } = quietCli();
      const out = await bundle(name, root, { XDG_RUNTIME_DIR: runtimeDir(), SQUEAL_CLI: cli });
      expect(out).toMatchObject({ stdout: "", stderr: "", code: 0 });
      await sleep(50);
      expect(() => readFileSync(ran)).toThrow();
    },
  );

  it.each(HOOKS)("%s exits 0 silently on a store with a newer schema", async (name) => {
    const r = squealRepo();
    r.apply(r.fail());
    r.store.close();
    const db = new DatabaseSync(storePaths(r.repo.commonDir).database);
    db.exec("PRAGMA user_version = 999");
    db.close();
    const out = await bundle(name, r.root, {
      XDG_RUNTIME_DIR: runtimeDir(),
      SQUEAL_CLI: quietCli().cli,
    });
    expect(out).toMatchObject({ stdout: "", stderr: "", code: 0 });
  });
});

describe("bundled Codex hooks, recorded JSON in and JSON out", () => {
  it("serve a codex exec session end to end", async () => {
    const r = squealRepo();
    r.apply(r.pass(), r.pass(SUBTRACTS));
    const env = { XDG_RUNTIME_DIR: runtimeDir() };
    await liveSocket(join(env.XDG_RUNTIME_DIR, `squeal-${r.worktreeId}.sock`));
    const json = async (name: CodexHookName) => {
      const out = await bundle(name, r.root, env);
      expect(out, name).toMatchObject({ stderr: "", code: 0 });
      return out.stdout === "" ? null : JSON.parse(out.stdout);
    };

    expect(await json("session-start")).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringMatching(/^SQUEAL · registered at revision 1\n/),
      },
    });
    expect(await json("user-prompt-submit")).toBeNull();
    expect(await json("subagent-start")).toEqual({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: expect.stringMatching(/^SQUEAL · registered at revision 1\n/),
      },
    });
    r.apply(r.fail());
    expect(await json("pre-tool-use")).toBeNull();
    expect(await json("post-tool-use")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining("PASS -> FAIL"),
      },
    });
    expect(await json("post-tool-use")).toBeNull();
    r.apply(r.fail(), r.fail(SUBTRACTS));
    expect(await json("stop")).toEqual({
      decision: "block",
      reason: expect.stringMatching(/^SQUEAL · 1 check changed at revision 3\n[\s\S]*PASS -> FAIL/),
    });
    expect(await json("subagent-stop")).toBeNull();
    expect(await json("interrupt")).toBeNull();
    expect(await json("session-end")).toBeNull();
    expect(r.store.consumers.list(r.worktreeId)).toEqual([]);
  });
});
