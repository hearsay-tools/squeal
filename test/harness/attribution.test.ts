import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { bootstrappedMetaKey } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { result } from "../state/helpers.js";
import { ADDS, FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-94, review wave 10b B1: "touches your changes" counts from the
 * revision the session first registered at. SessionStart `resume` and
 * `compact` keep it, so an edit made before either still counts.
 */

const INTERACTIVE = { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return { env: INTERACTIVE, ensureDaemon: async () => "alive", ...overrides };
}

function context(out: HookResult): string {
  const parsed = JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } };
  return parsed.hookSpecificOutput.additionalContext;
}

/** A repository whose test file imports `src/math.ts`, passing at revision 1. */
function repo(): SquealRepo {
  const r = squealRepo();
  r.store.testFiles.put({
    testFile: FILE,
    closure: {
      testFile: FILE,
      paths: ["src/math.test.ts", "src/math.ts"],
      complete: false,
      method: "static imports plus declared inputs",
    },
    updatedAt: 1,
    updatedBy: r.worktreeId,
  });
  r.apply(r.pass());
  return r;
}

/** `ADDS` fails at a revision that changed only `README.md`. */
function failAfterReadme(r: SquealRepo): void {
  const { number } = r.store.revisions.append({
    worktreeId: r.worktreeId,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "README.md", oldHash: null, newHash: "readme" }],
  });
  const failed = result(ADDS, "fail", { key: "k1", worktreeId: r.worktreeId, revision: number });
  r.store.results.putMany([failed]);
  r.sink.applyResults(r.worktreeId, number, [failed], { checkpointId: null });
}

async function sessionStart(r: SquealRepo, source: string): Promise<void> {
  await runHook("session-start", recorded("session-start", r.root, { source }), deps());
}

describe("an edit before SessionStart resume or compact", () => {
  it.each(["resume", "compact"])("still touches the agent's changes after %s", async (source) => {
    const r = repo();
    await sessionStart(r, "startup");
    r.apply(); // the agent edits src/math.ts
    await sessionStart(r, source);
    failAfterReadme(r);
    const text = context(
      await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps()),
    );
    expect(text).toContain("touches your changes: src/math.ts");
    expect(text).not.toContain("none of your changes");
  });
});

/*
 * Task 001-96 (review wave 10c B1, S1): SessionStart waits for the spawned
 * daemon's heartbeat only, never for its start scan. No `start` revision is
 * the agent's, and "none of your changes" needs a daemon that had scanned
 * when the session registered.
 */
describe("SessionStart after spawning a daemon", () => {
  /**
   * A new daemon `startedAt`: heartbeat at `heartbeatMs`, then at `scanMs`
   * its start scan, a `start` revision changing `scanned` when any, and the
   * bootstrap marker.
   */
  function spawning(
    r: SquealRepo,
    { heartbeatMs = 20, scanMs = 150, scanned = [] as string[], startedAt = 2 } = {},
  ): HookDeps {
    return deps({
      ensureDaemon: async () => {
        setTimeout(() => {
          r.store.worktrees.setDaemon(r.worktreeId, {
            socketPath: `/tmp/squeal-test-${r.worktreeId}.sock`,
            startedAt,
            heartbeatAt: Date.now(),
            heartbeatIntervalMs: 3_600_000,
            squealVersion: "0.0.0-test",
          });
        }, heartbeatMs);
        setTimeout(() => {
          if (scanned.length > 0) {
            r.store.revisions.append({
              worktreeId: r.worktreeId,
              createdAt: 1,
              head: null,
              dirty: false,
              trigger: "start",
              changes: scanned.map((path) => ({ path, oldHash: "a", newHash: "scanned" })),
            });
          }
          r.store.meta.set(bootstrappedMetaKey(r.worktreeId), String(startedAt));
        }, scanMs);
        return "spawned";
      },
    });
  }

  async function postToolBatch(r: SquealRepo): Promise<string> {
    return context(await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps()));
  }

  /** SessionStart `source` spawning a daemon; resolves once its start scan is recorded. */
  async function spawnSession(
    r: SquealRepo,
    source: string,
    options: Parameters<typeof spawning>[1] = {},
  ): Promise<number> {
    const started = performance.now();
    await runHook(
      "session-start",
      recorded("session-start", r.root, { source }),
      spawning(r, options),
    );
    const elapsed = performance.now() - started;
    await sleep((options.scanMs ?? 150) + 50);
    return elapsed;
  }

  it("returns on the heartbeat, before the start scan", async () => {
    const r = repo();
    r.daemon("none");
    const elapsed = await spawnSession(r, "startup", { scanMs: 400 });
    expect(elapsed).toBeLessThan(400);
  });

  it("gives attribution from the first PostToolBatch after the start revision (case 1)", async () => {
    const r = repo();
    r.daemon("none");
    await spawnSession(r, "startup", { scanned: ["package.json"] });
    r.apply(); // the agent edits src/math.ts
    failAfterReadme(r);
    const text = await postToolBatch(r);
    expect(text).toContain("touches your changes: src/math.ts");
  });

  it("counts none of a restarted daemon's start revision as the agent's (case 2, wave 10c B1 probe)", async () => {
    const r = repo();
    await sessionStart(r, "startup");
    // A reboot: no SessionEnd. Someone pulls src/math.ts while no daemon runs.
    r.daemon("none");
    await spawnSession(r, "resume", { startedAt: 99, scanned: ["src/math.ts"] });
    failAfterReadme(r);
    const text = await postToolBatch(r);
    expect(text).toContain("FAIL  src/math.test.ts > math > adds");
    expect(text).not.toContain("your changes");
  });

  it("gives neither line for an agent edit absorbed into the start revision (case 3)", async () => {
    const r = repo();
    r.daemon("none");
    // The agent's first edit of src/math.ts lands before the scan reads it.
    await spawnSession(r, "startup", { scanned: ["src/math.ts"] });
    failAfterReadme(r);
    const text = await postToolBatch(r);
    expect(text).toContain("FAIL  src/math.test.ts > math > adds");
    expect(text).not.toContain("your changes");
  });

  it("never says none of your changes after a new worktree's seeding", async () => {
    const r = repo();
    r.daemon("none");
    // An empty cache: the scan hashes every file without a revision, the agent's early edit too.
    await spawnSession(r, "startup");
    failAfterReadme(r);
    const text = await postToolBatch(r);
    expect(text).toContain("FAIL  src/math.test.ts > math > adds");
    expect(text).not.toContain("your changes");
  });
});

/*
 * Task 001-99 (review wave 10d, S2): a registration that follows the
 * session's tool calls holds their edits in its registration revision, so
 * it never says "none": the `-p` probe P5.
 */
describe("a registration after the session's tool calls", () => {
  const PRINT = { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" };

  it("never says none of the changes when PostToolBatch registers after an edit (P5)", async () => {
    const r = repo();
    r.apply(); // the agent's first batch edits src/math.ts before any registration
    const post = () =>
      runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps({ env: PRINT }));
    await post(); // registers, with the edit in its registration revision
    failAfterReadme(r);
    const text = context(await post());
    expect(text).toContain("FAIL  src/math.test.ts > math > adds");
    expect(text).not.toContain("none of");
  });

  it("never says none of the changes when SessionStart compact registers again", async () => {
    const r = repo();
    r.apply(); // the run's edit, before compaction; its consumer expired meanwhile
    await sessionStart(r, "compact");
    failAfterReadme(r);
    const text = context(
      await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps()),
    );
    expect(text).toContain("FAIL  src/math.test.ts > math > adds");
    expect(text).not.toContain("none of");
  });

  it("says none of the changes after SessionStart startup", async () => {
    const r = repo();
    await sessionStart(r, "startup");
    failAfterReadme(r);
    const text = context(
      await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps()),
    );
    expect(text).toContain("none of");
  });

  it("still names a file changed after PostToolBatch registered", async () => {
    const r = repo();
    const post = () =>
      runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps({ env: PRINT }));
    await post();
    r.apply();
    failAfterReadme(r);
    expect(context(await post())).toContain("src/math.ts");
  });
});
