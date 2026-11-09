import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ciCommand } from "../../src/cli/ci.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { cloneWith, exportOf, remoteRefs, type Scratch, scratchRemote } from "../shared/remote.js";

/*
 * Spec 018 D13 (row 018-20): `squeal ci publish <export> [--keep <n>]`'s
 * usage, its prefix from `shared.ref`, and what it refuses: exit 1, the
 * reason named, nothing pushed. `test/ci/publish.test.ts` tests the ref and
 * the pruning.
 */

const scratches: Scratch[] = [];
afterEach(() => {
  for (const s of scratches.splice(0)) s.cleanup();
});

function capture(cwd: string): { io: CliIo; text: () => string } {
  let text = "";
  const add = (chunk: string) => {
    text += chunk;
  };
  return { io: { stdout: add, stderr: add, cwd, env: process.env }, text: () => text };
}

function setup(files: Record<string, string> = {}) {
  const scratch = scratchRemote();
  scratches.push(scratch);
  return { scratch, ...cloneWith(scratch, "ci", 2, files) };
}

describe("squeal ci publish's usage (018 D13)", () => {
  it.each([
    [[], "names no export"],
    [["a", "b"], "takes one export"],
    [["a", "--keep", "0"], "--keep takes a whole number"],
    [["a", "--keep"], "--keep takes a whole number"],
    [["a", "--remote", "x"], 'unknown option "--remote"'],
  ])("exits 2 for %j", async (args, text) => {
    const { io, text: said } = capture("/");
    expect(await ciCommand(["publish", ...args], io)).toBe(2);
    expect(said()).toContain(text);
    expect(said()).toContain("usage: squeal ci publish <export> [--keep <n>]");
  });

  it("is in ci's own usage and in the CLI help", async () => {
    const { io, text } = capture("/");
    expect(await ciCommand([], io)).toBe(2);
    expect(text()).toContain("usage: squeal ci publish");
    const help = capture("/");
    expect(await main(["ci", "--help"], help.io)).toBe(0);
    expect(help.text()).toContain("squeal ci publish <export> [--keep <n>]");
  });
});

describe("squeal ci publish (018 D13)", () => {
  it("pushes under shared.ref and prunes beyond --keep", async () => {
    const config = { "squeal.config.json": JSON.stringify({ shared: { ref: "refs/ci/sq" } }) };
    const { scratch, root, commits } = setup(config);
    const [older, newer] = commits as [string, string];
    writeFileSync(join(root, "old.json.gz"), exportOf(older));
    writeFileSync(join(root, "new.json.gz"), exportOf(newer));
    expect(await ciCommand(["publish", "old.json.gz"], capture(root).io)).toBe(0);
    const { io, text } = capture(root);
    expect(await ciCommand(["publish", "new.json.gz", "--keep=1"], io)).toBe(0);
    expect(text()).toBe(
      `Published refs/ci/sq/${newer}; deleted 1 ref beyond the newest 1 main commits.\n`,
    );
    expect(remoteRefs(scratch, "refs/ci/sq")).toEqual([`refs/ci/sq/${newer}`]);
    expect(remoteRefs(scratch, "refs/squeal")).toEqual([]);
  });

  it("refuses a missing file and a file that is no export, and pushes nothing", async () => {
    const { scratch, root } = setup();
    writeFileSync(join(root, "junk.json.gz"), "{}");
    const missing = capture(root);
    expect(await ciCommand(["publish", "absent.json.gz"], missing.io)).toBe(1);
    expect(missing.text()).toContain("cannot read");
    expect(missing.text()).toContain("published nothing");
    const junk = capture(root);
    expect(await ciCommand(["publish", "junk.json.gz"], junk.io)).toBe(1);
    expect(junk.text()).toBe("squeal ci publish: not a gzipped JSON file; published nothing\n");
    expect(remoteRefs(scratch)).toEqual([]);
  });

  it("refuses outside a git worktree", async () => {
    const { io, text } = capture("/");
    expect(await ciCommand(["publish", "x.json.gz"], io)).toBe(1);
    expect(text()).toContain("is not inside a git worktree; published nothing");
  });
});
