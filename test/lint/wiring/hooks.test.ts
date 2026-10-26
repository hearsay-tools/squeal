import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type HookDeps, runHook } from "../../../src/harness/claude-code/index.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { recorded, squealRepo } from "../../harness/helpers.js";
import { lintOver } from "./rig.js";

/*
 * Spec 017 D8 through the Claude Code hooks: the registration's lint line,
 * a FAIL told at the next tool batch, never a denied tool call, and Stop
 * held only with `lint.blocking` and only by a file gone to fail since the
 * session registered. The real lint pass writes the store.
 */

const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

/** A repository whose `lint` policy is `lint`, with `files` linted once at revision 1. */
async function hooked(files: Record<string, string>, lint: object) {
  const r = squealRepo();
  r.apply(r.pass());
  writeFileSync(join(r.root, "squeal.config.json"), JSON.stringify({ lint }));
  const tree = new FakeWorktree(r.worktreeId, r.repo.commonDir).write(
    "eslint.config.js",
    "export default [];\n",
  );
  for (const [path, text] of Object.entries(files)) tree.write(path, text);
  tree.revise();
  const { settle } = await lintOver(tree);
  const edit = async (changed: Record<string, string>) => {
    for (const [path, text] of Object.entries(changed)) tree.write(path, text);
    tree.revise();
    r.apply();
    await settle();
  };
  const hook = (name: Parameters<typeof runHook>[0]) => runHook(name, recorded(name, r.root), deps);
  return { r, edit, hook };
}

const contextOf = (stdout: string): string => {
  const out = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
  return out.hookSpecificOutput?.additionalContext ?? "";
};

const ON = { enabled: true };
const BLOCKING = { enabled: true, blocking: true };

describe("lint through the Claude Code hooks (017 D8)", () => {
  it("registers with the count, tells the edit's FAIL, denies no edit and holds no Stop", async () => {
    const { edit, hook } = await hooked({ "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" }, ON);
    const start = await hook("session-start");
    expect(contextOf(start.stdout).split("\n")).toContain(
      "Lint: 1 file with findings; squeal lint lists them.",
    );
    await edit({ "src/b.js": "bad no-console\n" });
    const pre = await hook("pre-tool-use");
    expect(pre.stdout).not.toContain("deny");
    const batch = await hook("post-tool-batch");
    expect(contextOf(batch.stdout).split("\n")).toContain(
      "FAIL lint: src/b.js: 1 finding, +1 no-console (no-console found)",
    );
    expect(contextOf(batch.stdout)).not.toMatch(/Known failures: [1-9]/);
    // D8: without lint.blocking a Stop says nothing more.
    expect((await hook("stop")).stdout).toBe("");
  });

  it("with lint.blocking, holds Stop for a file gone to fail since registration, never denying an edit", async () => {
    const { r, edit, hook } = await hooked(
      { "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" },
      BLOCKING,
    );
    await hook("session-start");
    await edit({ "src/b.js": "bad no-console\nbad eqeqeq\n" });
    expect((await hook("pre-tool-use")).stdout).not.toContain("deny");
    const stop = JSON.parse((await hook("stop")).stdout) as { decision?: string; reason?: string };
    expect(stop.decision).toBe("block");
    expect(stop.reason).toContain(
      "Squeal policy lint.blocking is on and 1 file went to fail lint since this session started: src/b.js (2 findings). `squeal lint --changed` lists them.",
    );
    // `src/a.js` failed before the session registered: it is not named.
    expect(stop.reason).not.toContain("src/a.js");
    // The control: in this repository a test's regression is denied; the lint ones above were not.
    r.apply(r.fail());
    expect((await hook("pre-tool-use")).stdout).toContain('"permissionDecision":"deny"');
  });

  it("with lint.blocking, lets Stop through once the file is fixed", async () => {
    const { edit, hook } = await hooked({ "src/a.js": "ok\n" }, BLOCKING);
    await hook("session-start");
    await edit({ "src/a.js": "bad no-undef\n" });
    expect((await hook("stop")).stdout).toContain('"decision":"block"');
    await edit({ "src/a.js": "ok\n" });
    expect((await hook("stop")).stdout).not.toContain("lint.blocking");
  });
});
