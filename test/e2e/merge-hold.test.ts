import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { type E2E, e2eSuite, MATH, PLUGINS, until } from "./harness.js";

/*
 * Row 011-73 (gh-68; spec 011 C6, C8 and C9 as amended 2026-10-21;
 * `tasks/011-61/design.md` R2, test 7), end to end for each hook plugin, as
 * `research/probes/issue-68/run.sh` drove 0.1.235: a conflicted `git merge`
 * holds validation. The boundary after it says the hold in one line and no
 * FAIL, the next says nothing, and a wait returns with the hold and exits
 * 3. The resolved write and `git add` end it: a wait then waits for the
 * importer, and the next boundary says `validating again`, with no FAIL and
 * no recovery.
 */

const fixture = e2eSuite();

const MERGED = "src/math.ts";

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  });

/**
 * Branches `side` and `main` apart on `src/math.ts`'s first line, its
 * counter comment: each side passes, and only the merge's markers fail.
 */
function divergedOnMath(e: E2E): void {
  git(e.main, ["checkout", "-q", "-b", "side"]);
  e.write(e.main, "math", MATH());
  git(e.main, ["commit", "-qam", "side"]);
  git(e.main, ["checkout", "-q", "main"]);
  e.write(e.main, "math", MATH());
  git(e.main, ["commit", "-qam", "main"]);
}

/** `git merge side`, which stops on the conflict: exit 1. */
function mergeSide(e: E2E): void {
  try {
    git(e.main, ["merge", "side"]);
  } catch (error) {
    expect((error as { status?: number }).status).toBe(1);
    return;
  }
  throw new Error("git merge side did not stop on a conflict");
}

describe.each(PLUGINS)("an unresolved merge holds validation (gh-68), $name", (plugin) => {
  it("says the hold once, gives no FAIL, and validates again after `git add`", async (ctx) => {
    const e = fixture(ctx, plugin);
    divergedOnMath(e);
    await e.hook("session-start", e.main);
    await e.daemonReady(e.main);
    await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0);
    await e.hook("post-tool-batch", e.main);

    mergeSide(e);
    expect(git(e.main, ["ls-files", "-u"])).toContain(MERGED);
    await until("the daemon to publish the merge hold", 30_000, async () => {
      const s = await e.status(e.main);
      return s.holds?.some((h) => h.cause === "merge") === true ? s : null;
    });

    const held = await e.hook("post-tool-batch", e.main);
    expect(held).toMatchObject({ code: 0, stderr: "" });
    expect(held.text).toMatch(
      /^SQUEAL · validation on hold at revision \d+: git lists 1 unmerged path \(src\/math\.ts\)\. No test runs until git lists none: resolve it and `git add` it, or abort\.\n/,
    );
    expect(held.text).not.toContain("FAIL");
    expect((await e.hook("post-tool-batch", e.main)).text).toBeNull();

    const status = await e.cli(e.main, ["status"]);
    expect(status.stdout.split("\n")[1]).toMatch(/^On hold: unresolved merge since /);
    expect(status.stdout).not.toMatch(/^ {2}FAIL /m);
    const waited = await e.cli(e.main, ["status", "--wait", "30000"]);
    expect(waited.code).toBe(3);
    expect(waited.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^On hold: unresolved merge, git lists 1 unmerged path \(src\/math\.ts\); no verdict/,
    );
    const named = await e.cli(e.main, ["status", "--wait", "30000", "test/math.test.ts"]);
    expect(named.code).toBe(3);
    expect(named.stdout).toContain(
      `queued, on hold for the unresolved merge (git lists ${MERGED} unmerged)`,
    );
    const stopped = await e.hook("stop", e.main);
    expect(stopped.code).toBe(0);
    expect(stopped.text ?? "").not.toContain("FAIL");

    // Resolve: the resolved write still holds; `git add` alone ends the hold.
    e.write(e.main, "math", MATH());
    git(e.main, ["add", MERGED]);
    const resolved = await e.cli(e.main, ["status", "--wait", "60000"]);
    expect(resolved.code).toBe(0);
    expect(resolved.stdout).not.toContain("On hold:");
    await e.settle(e.main, "the importer at the resolved bytes", (s) => s.holds === undefined);

    const again = await e.hook("post-tool-batch", e.main);
    expect(again.text).toMatch(
      /^SQUEAL · validating again at revision \d+: git lists no unmerged path;/,
    );
    expect(again.text).not.toContain("FAIL");
    expect(again.text).not.toContain("PASS");
    expect((await e.hook("post-tool-batch", e.main)).text).toBeNull();
  }, 240_000);
});
