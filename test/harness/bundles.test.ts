import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { tempDir } from "../store/helpers.js";
import { liveSocket, outsideGit, runBundle, runtimeDir } from "./bundle-helpers.js";
import { recorded, SUBTRACTS, squealRepo } from "./helpers.js";

const HOOKS = ["session-start", "post-tool-batch", "pre-tool-use", "stop", "session-end", "waiter"];
const EVENT_OF: Record<string, string> = {
  "session-start": "session-start",
  "post-tool-batch": "post-tool-batch",
  "pre-tool-use": "pre-tool-use",
  stop: "stop",
  "session-end": "session-end",
  waiter: "stop",
};
const INTERACTIVE = { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };

/** A CLI stand-in for spawned daemons: records that it ran, does nothing else. */
function quietCli(): { cli: string; ran: string } {
  const dir = tempDir("squeal-cli-");
  const ran = join(dir, "ran");
  const cli = join(dir, "cli.mjs");
  writeFileSync(
    cli,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(ran)}, "");\n`,
  );
  return { cli, ran };
}

describe("bundled hooks, recorded JSON in and JSON out", () => {
  it("serve every event end to end", async () => {
    const r = squealRepo();
    r.apply(r.pass(), r.fail(SUBTRACTS));
    const env = { XDG_RUNTIME_DIR: runtimeDir() };
    await liveSocket(join(env.XDG_RUNTIME_DIR, `squeal-${r.worktreeId}.sock`));

    const start = await runBundle("session-start", recorded("session-start", r.root), env);
    expect(start.code).toBe(0);
    expect(JSON.parse(start.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringMatching(/^SQUEAL · registered at revision 1\n/),
      },
    });

    const sub = await runBundle("session-start", recorded("subagent-start", r.root), env);
    expect(JSON.parse(sub.stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: "SubagentStart" },
    });

    r.apply(r.fail(), r.pass(SUBTRACTS));
    const deny = await runBundle("pre-tool-use", recorded("pre-tool-use", r.root), env);
    expect(JSON.parse(deny.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringMatching(
          /PASS -> FAIL[\s\S]*so the edit was not applied\. The same call can be re-issued/,
        ),
      },
    });
    const allow = await runBundle("pre-tool-use", recorded("pre-tool-use", r.root), env);
    expect(allow).toMatchObject({ stdout: "", stderr: "", code: 0 });

    const batch = await runBundle("post-tool-batch", recorded("post-tool-batch", r.root), env);
    expect(JSON.parse(batch.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolBatch",
        additionalContext: expect.stringContaining("FAIL -> PASS"),
      },
    });

    r.policy({ stop: { blockOnKnownFailures: true } });
    const block = await runBundle("stop", recorded("stop", r.root), env);
    expect(JSON.parse(block.stdout)).toEqual({
      decision: "block",
      reason: expect.stringMatching(
        /^Squeal policy stop.blockOnKnownFailures is on and 1 known failure exists at revision 2: src\/math.test.ts > math > adds\./,
      ),
    });

    r.policy({});
    const subStop = await runBundle("stop", recorded("subagent-stop", r.root), env);
    expect(JSON.parse(subStop.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SubagentStop",
        additionalContext: expect.stringMatching(/^SQUEAL · \d check(s)? changed at revision 2\n/),
      },
    });

    const end = await runBundle("session-end", recorded("session-end", r.root), env);
    expect(end).toMatchObject({ stdout: "", stderr: "", code: 0 });
    expect(r.store.consumers.list(r.worktreeId)).toEqual([]);
  });
});

describe("bundled waiter", () => {
  it("exits 2 with the delta on stderr when a transition arrives", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const env = { XDG_RUNTIME_DIR: runtimeDir() };
    await runBundle("session-start", recorded("session-start", r.root), {
      ...env,
      SQUEAL_CLI: quietCli().cli,
    });
    const waiting = runBundle("waiter", recorded("stop", r.root), { ...env, ...INTERACTIVE });
    await sleep(300);
    r.apply(r.fail());

    const out = await waiting;
    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^SQUEAL · 1 check changed at revision 2\n[\s\S]*PASS -> FAIL/);
  });

  it("exits 0 silently on timeout", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runBundle("session-start", recorded("session-start", r.root), {
      XDG_RUNTIME_DIR: runtimeDir(),
      SQUEAL_CLI: quietCli().cli,
    });
    const out = await runBundle("waiter", recorded("stop", r.root), {
      ...INTERACTIVE,
      SQUEAL_WAITER_TIMEOUT_MS: "300",
    });
    expect(out).toMatchObject({ stdout: "", stderr: "", code: 0 });
    expect(out.ms).toBeGreaterThanOrEqual(300);
  });
});

describe("bundled hooks without a usable store", () => {
  it.each(HOOKS)("%s exits 0 silently outside any git worktree", async (name) => {
    const out = await runBundle(name, recorded(EVENT_OF[name] ?? name, outsideGit()), INTERACTIVE);
    expect(out).toMatchObject({ stdout: "", stderr: "", code: 0 });
  });

  it.each(HOOKS)(
    "%s exits 0 silently in a repository without Squeal, spawning nothing",
    async (name) => {
      const r = squealRepo();
      r.store.close();
      const root = tempDir();
      mkdirSync(join(root, ".git"));
      const { cli, ran } = quietCli();
      const out = await runBundle(name, recorded(EVENT_OF[name] ?? name, root), {
        ...INTERACTIVE,
        XDG_RUNTIME_DIR: runtimeDir(),
        SQUEAL_CLI: cli,
      });
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
    const out = await runBundle(name, recorded(EVENT_OF[name] ?? name, r.root), {
      ...INTERACTIVE,
      XDG_RUNTIME_DIR: runtimeDir(),
      SQUEAL_CLI: quietCli().cli,
    });
    expect(out).toMatchObject({ stdout: "", stderr: "", code: 0 });
  });

  it.each(HOOKS)("%s exits 0 on a corrupt store file", async (name) => {
    const r = squealRepo();
    r.store.close();
    writeFileSync(storePaths(r.repo.commonDir).database, "not a database at all, just text");
    const out = await runBundle(name, recorded(EVENT_OF[name] ?? name, r.root), {
      ...INTERACTIVE,
      XDG_RUNTIME_DIR: runtimeDir(),
      SQUEAL_CLI: quietCli().cli,
    });
    expect(out).toMatchObject({ stdout: "", stderr: "", code: 0 });
  });
});

describe("bundled hooks with a dead daemon", () => {
  it("start a daemon, keep serving deltas from the store, and never stall", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const env = { XDG_RUNTIME_DIR: runtimeDir() };
    // What a SIGKILLed daemon leaves: a socket file nobody listens on and an old heartbeat.
    const socket = join(env.XDG_RUNTIME_DIR, `squeal-${r.worktreeId}.sock`);
    writeFileSync(socket, "");
    r.store.worktrees.setDaemon(r.worktreeId, {
      socketPath: socket,
      startedAt: 1,
      heartbeatAt: 1,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    });
    const { cli, ran } = quietCli();

    const start = await runBundle("session-start", recorded("session-start", r.root), {
      ...env,
      SQUEAL_CLI: cli,
    });
    r.apply(r.fail());
    const again = quietCli();
    const batch = await runBundle("post-tool-batch", recorded("post-tool-batch", r.root), {
      ...env,
      SQUEAL_CLI: again.cli,
    });

    expect(start).toMatchObject({ stderr: "", code: 0 });
    expect(start.stdout).toContain("registered at revision 1");
    expect(start.stdout).toContain(
      "No daemon has validated since 1970-01-01T00:00:00.001Z; results are as of revision 1.",
    );
    expect(start.ms).toBeLessThan(1_500);
    expect(batch).toMatchObject({ stderr: "", code: 0 });
    expect(batch.stdout).toContain("PASS -> FAIL");
    expect(batch.stdout).toContain("No daemon has validated since");
    await sleep(200);
    expect(() => readFileSync(ran)).not.toThrow();
    // Review wave 3, S2: PostToolBatch restarts a daemon whose heartbeat is stale.
    expect(() => readFileSync(again.ran)).not.toThrow();
  });
});
