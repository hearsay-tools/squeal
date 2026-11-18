import { describe, expect, it } from "vitest";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER } from "../../src/harness/shared/primer.js";
import {
  hookText as context,
  hangingEnsure,
  recorded,
  type SquealRepo,
  squealRepo,
} from "./helpers.js";

/*
 * Row 005-98 (option A, the human 2026-11-17): under Squawk a session ends at each turn end
 * and the daemon stops 3 s later; the next turn's SessionStart `resume` spawned a daemon and
 * waited for its heartbeat before it registered, and Claude Code killed it at its 2 s timeout.
 * The first tool boundary then registered with the whole primer (`tasks/005-95/notes.md`).
 * SessionStart now registers before it starts the daemon, so a hook killed while the daemon
 * starts has registered, and the boundary after it does not register again.
 */

/** `plugins/claude-code/hooks/hooks.json`: the SessionStart hook's timeout. */
const HOOK_TIMEOUT_MS = 2_000;
const POLL_MS = 10;

/**
 * A SessionStart with source `source` whose daemon start does not end before the hook's
 * timeout: its `ensureDaemon` resolves only on `release`. `hook` is the hook's promise, which
 * the harness would have killed; the test lets it end after its checks.
 */
function hangingStart(r: SquealRepo, source: string) {
  const start = hangingEnsure();
  const deps: HookDeps = {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    ensureDaemon: start.ensureDaemon,
  };
  const hook = runHook("session-start", recorded("session-start", r.root, { source }), deps);
  return { hook, release: start.release, spawnAsked: start.asked };
}

/** Polls until `r`'s main consumer is registered or `ms` passed; whether it is. */
async function registeredWithin(r: SquealRepo, ms: number): Promise<boolean> {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (r.store.consumers.get(r.consumer()) !== null) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return r.store.consumers.get(r.consumer()) !== null;
}

const batch = (r: SquealRepo) =>
  runHook("post-tool-batch", recorded("post-tool-batch", r.root), {
    env: {},
    ensureDaemon: async () => "alive",
  });

describe("a SessionStart whose daemon start outlasts the hook's timeout (row 005-98)", () => {
  it.each(["resume", "startup"])(
    "has registered the session on %s before the hook is killed",
    async (source) => {
      const r = squealRepo();
      r.apply(r.pass());
      r.daemon("none");
      const start = hangingStart(r, source);

      expect(await registeredWithin(r, HOOK_TIMEOUT_MS)).toBe(true);
      // The daemon's start was asked after the registration, and has not ended.
      await expect.poll(start.spawnAsked).toBe(true);
      start.release();
      await start.hook;
    },
  );

  it("is followed by a tool boundary that says the registration once, with no primer on resume", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const start = hangingStart(r, "resume");
    expect(await registeredWithin(r, HOOK_TIMEOUT_MS)).toBe(true);
    await expect.poll(start.spawnAsked).toBe(true);

    // The hook is killed here: its output never reaches the session. The daemon comes up.
    r.daemon("alive");
    const owed = context((await batch(r)).stdout);
    expect(owed).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(owed).not.toContain(PRIMER);
    // Handed over: the next boundary says only news.
    expect((await batch(r)).stdout).toBe("");
    r.apply(r.fail());
    const text = context((await batch(r)).stdout);
    expect(text).not.toMatch(/registered at revision/);
    expect(text).toContain("FAIL");
    start.release();
    await start.hook;
  });

  it("registers a resumed session with no primer while its daemon starts (0.1.527's rule)", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root, { source: "resume" }),
      { env: {}, cli: "/plugin/dist/cli/squeal.mjs", ensureDaemon: async () => "spawned" },
    );
    const text = context(out.stdout);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text).toContain("A daemon is starting");
    expect(text).not.toContain(PRIMER);
    expect(text).not.toContain("Squeal runs this repository's");
  });

  it("without a registration first, is followed by a boundary that registers with the primer", async () => {
    // The chain the row removes, for contrast: no registration, so the boundary registers.
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("alive");
    const text = context((await batch(r)).stdout);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text).toContain(PRIMER);
  });
});
