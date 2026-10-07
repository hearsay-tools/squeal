import { describe, expect, it } from "vitest";
import { bootstrappedMetaKey } from "../../src/core/types/index.js";
import {
  type HookDeps,
  type HookResult,
  runHook,
  SPAWN_SETTLE_MS,
} from "../../src/harness/claude-code/index.js";
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
 * Review wave 10b B2, decided (b): a SessionStart that spawned the daemon
 * waits within `SPAWN_SETTLE_MS` for the daemon's start scan to be recorded.
 * The scan's `start` revision holds what changed while no daemon ran, never
 * the agent's changes.
 */
describe("SessionStart after spawning a daemon", () => {
  /** A new daemon: heartbeat at `heartbeatMs`, its start scan changing `src/math.ts` at `scanMs`. */
  function spawning(r: SquealRepo, heartbeatMs: number, scanMs: number | null): HookDeps {
    r.daemon("none");
    return deps({
      ensureDaemon: async () => {
        setTimeout(() => {
          r.store.worktrees.setDaemon(r.worktreeId, {
            socketPath: `/tmp/squeal-test-${r.worktreeId}.sock`,
            startedAt: 2,
            heartbeatAt: Date.now(),
            heartbeatIntervalMs: 3_600_000,
            squealVersion: "0.0.0-test",
          });
        }, heartbeatMs);
        if (scanMs !== null) {
          setTimeout(() => {
            r.store.revisions.append({
              worktreeId: r.worktreeId,
              createdAt: 1,
              head: null,
              dirty: false,
              trigger: "start",
              changes: [{ path: "src/math.ts", oldHash: "a", newHash: "pulled" }],
            });
            r.store.meta.set(bootstrappedMetaKey(r.worktreeId), "2");
          }, scanMs);
        }
        return "spawned";
      },
    });
  }

  async function afterReadme(r: SquealRepo): Promise<string> {
    failAfterReadme(r);
    return context(await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps()));
  }

  it("waits for the start scan and counts none of it as the agent's", async () => {
    const r = repo();
    const started = performance.now();
    await runHook("session-start", recorded("session-start", r.root), spawning(r, 50, 200));
    expect(performance.now() - started).toBeLessThan(SPAWN_SETTLE_MS);
    const text = await afterReadme(r);
    expect(text).toContain("none of your changes are in its imports");
  });

  it("gives no attribution line when the start scan outlasts the wait", async () => {
    const r = repo();
    const started = performance.now();
    await runHook("session-start", recorded("session-start", r.root), spawning(r, 50, null));
    expect(performance.now() - started).toBeGreaterThanOrEqual(SPAWN_SETTLE_MS - 10);
    // The scan lands after the registration, with the files pulled while no daemon ran.
    r.store.revisions.append({
      worktreeId: r.worktreeId,
      createdAt: 1,
      head: null,
      dirty: false,
      trigger: "start",
      changes: [{ path: "src/math.ts", oldHash: "a", newHash: "pulled" }],
    });
    r.store.meta.set(bootstrappedMetaKey(r.worktreeId), "2");
    const text = await afterReadme(r);
    expect(text).toContain("FAIL  src/math.test.ts > math > adds");
    expect(text).not.toContain("your changes");
  });
});
