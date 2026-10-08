import { describe, expect, it } from "vitest";
import { runHook } from "../../src/harness/claude-code/index.js";
import { codexCommand } from "../../src/harness/codex/command.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { CONTEXT_CAP_CHARS, capContext } from "../../src/harness/codex/output.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER, primer } from "../../src/harness/shared/primer.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Spec 004 D8, D9: with a slow tier the primer drops "Squeal does not cover
 * ... other test suites" and says slow suites run when the agent pauses or
 * on `run --slow`. Claude Code wakes an idle agent with a slow failure;
 * Codex has no idle wake, so there it arrives with the next prompt or tool
 * call. Without a slow tier the primer is as before.
 */

const CODEX = codexCommand({ PLUGIN_ROOT: "/plugins/squeal" }, "/unused.mjs");

describe("the primer with and without a slow tier (spec 004 D8, D9)", () => {
  it("is unchanged without a slow tier, under both harnesses", () => {
    expect(primer("squeal", false, false)).toBe(PRIMER);
    for (const command of ["squeal", CODEX]) {
      const text = primer(command);
      expect(text).toContain("Squeal does not cover typecheck, build or other test suites.");
      expect(text).not.toMatch(/slow/i);
    }
  });

  it("under Claude Code, names slow suites, when they run, and the idle wake", () => {
    const text = primer("squeal", false, true);
    expect(text).not.toContain("other test suites");
    expect(text).toContain("Squeal does not cover typecheck or build.");
    expect(text).toContain(
      "Slow test suites run when you pause between turns or on `squeal run --slow`, never during Stop's wait;",
    );
    expect(text).toContain("a slow failure wakes you when you are idle in an interactive session");
    expect(text.length).toBeLessThan(1_200);
  });

  it("under Codex, says a slow failure arrives with the next prompt or tool call", () => {
    const text = primer(CODEX, true, true);
    expect(text).not.toContain("other test suites");
    expect(text).toContain(`on \`${CODEX} run --slow\``);
    expect(text).toContain("a slow failure arrives with your next prompt or tool call.");
    expect(text).not.toContain("wakes you");
  });

  it("is kept whole when a Codex hook cuts a long text", () => {
    const tail = primer(CODEX, false, true);
    const text = `${Array.from({ length: 600 }, (_, i) => `FAIL  check ${i}`).join("\n")}\n\n${tail}`;
    const capped = capContext(text, CODEX);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(`\n\n${tail}`)).toBe(true);
  });
});

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

function slowRepo(slow: boolean): SquealRepo {
  const r = squealRepo();
  r.apply(r.pass());
  if (slow) r.policy({ slow: { include: ["test/e2e/**/*.test.ts"] } });
  return r;
}

function contextOf(stdout: string): string {
  const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
  return parsed.hookSpecificOutput.additionalContext;
}

describe("SessionStart carries the primer the policy calls for (spec 004 D8)", () => {
  it.each([false, true])("under Claude Code, slow tier %s", async (slow) => {
    const r = slowRepo(slow);
    const out = await runHook("session-start", recorded("session-start", r.root), deps);
    expect(contextOf(out.stdout).endsWith(`\n\n${primer("squeal", false, slow)}`)).toBe(true);
  });

  it.each([false, true])("under Codex, slow tier %s", async (slow) => {
    const r = slowRepo(slow);
    const command = "node codex-squeal.mjs";
    const out = await runCodexHook(
      "session-start",
      codexRecorded("exec", "session-start", r.root),
      { ...deps, command },
    );
    expect(contextOf(out.stdout).endsWith(`\n\n${primer(command, false, slow)}`)).toBe(true);
  });
});
