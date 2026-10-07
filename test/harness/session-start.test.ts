import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_CAP_CHARS } from "../../src/core/delivery/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { PRIMER } from "../../src/harness/shared/primer.js";
import { check } from "../state/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-88: where Squeal validates, SessionStart tells the agent that
 * Squeal runs the Vitest tests, so it keeps working instead of running them
 * to learn what its edits did; again after compaction, which drops it.
 */

const INTERACTIVE = { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };

function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  return { env: {}, ensureDaemon: async () => "alive", ...overrides };
}

function context(out: HookResult): string {
  const parsed = JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } };
  return parsed.hookSpecificOutput.additionalContext;
}

describe("the SessionStart primer", () => {
  it.each(["startup", "resume", "compact"])("follows the registration on %s", async (source) => {
    const r = squealRepo();
    r.apply(r.fail());
    const text = context(
      await runHook("session-start", recorded("session-start", r.root, { source }), deps()),
    );
    expect(text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
  });

  it("follows a subagent's registration", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const text = context(
      await runHook("session-start", recorded("subagent-start", r.root), deps()),
    );
    expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
  });

  /*
   * Without a usable store nothing validates yet, so the primer would be
   * false. SessionStart only spawns the daemon (D9); the first registration,
   * in UserPromptSubmit or PostToolBatch, carries the primer instead.
   */
  it("is absent where a squeal.config.json has no store yet, and the first registration carries it", async () => {
    const r = noStore();
    writeFileSync(join(r.root, "squeal.config.json"), "{}\n");
    let ensured = 0;
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps({
        ensureDaemon: async () => {
          ensured++;
          return "spawned";
        },
      }),
    );
    expect(out).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(ensured).toBe(1);

    for (const hook of ["post-tool-batch", "user-prompt-submit"] as const) {
      const fresh = squealRepo();
      fresh.apply(fresh.pass());
      const text = context(
        await runHook(hook, recorded(hook, fresh.root), deps({ env: INTERACTIVE })),
      );
      expect(text).toMatch(/^SQUEAL · registered at revision \d+\n/);
      expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
    }
  });

  it("is absent from a repository without a store or squeal.config.json", async () => {
    const r = noStore();
    const out = await runHook("session-start", recorded("session-start", r.root), deps());
    expect(out).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it(`keeps the registration and primer within ${MESSAGE_CAP_CHARS} characters with 40 known failures`, async () => {
    const r = squealRepo();
    const failures = Array.from({ length: 40 }, (_, i) =>
      r.fail(check(`suite ${"n".repeat(200)} > case ${i}`), `${"e".repeat(400)} ${i}`),
    );
    r.apply(...failures);
    const text = context(await runHook("session-start", recorded("session-start", r.root), deps()));
    expect(text).toContain("Known failures: 40");
    expect(text).toContain("Not shown: ");
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
  });

  it("says what the human decided, with the next tool call before `status --wait`", () => {
    expect(PRIMER).toContain("Squeal runs");
    expect(PRIMER).toMatch(/Vitest/);
    expect(PRIMER).toMatch(/do not run Vitest to learn whether/i);
    expect(PRIMER).toMatch(/no daemon/i);
    expect(PRIMER).toMatch(/unknown/);
    expect(PRIMER).toMatch(/own gate/);
    expect(PRIMER).toMatch(/typecheck, build or other test suites/);
    const next = PRIMER.indexOf("next tool call");
    expect(next).toBeGreaterThan(-1);
    expect(next).toBeLessThan(PRIMER.indexOf("squeal status --wait"));
    expect(PRIMER.length).toBeLessThan(1_000);
  });
});

/** A fixture repository whose store is removed: it uses Squeal only if it has a config. */
function noStore(): SquealRepo {
  const r = squealRepo();
  r.store.close();
  rmSync(`${r.repo.commonDir}/squeal`, { recursive: true });
  return r;
}
