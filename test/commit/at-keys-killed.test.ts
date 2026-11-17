import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { keysAtCommit } from "../../src/core/commit/at-keys.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { SLOW } from "../scheduler/cleanup.js";
import { fixture, git, keying, linkInstall, ref } from "./at-keys-fixture.js";

/*
 * Row 023-16, done-when; spec 023 D6: a run killed while its checkout
 * exists leaves no checkout after the next sweep, which the next
 * `keysAtCommit` that needs a checkout runs first. The killed run is a
 * child under tsx, stopped inside its install.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CHILD = resolve(import.meta.dirname, "at-keys-killed-child.ts");
const TEST = ref("test/a.test.ts");

const source = (value: number) => `export const value = ${value};\n`;
const TEST_TEXT = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'it("value", () => expect(value).toBeGreaterThan(0));',
  "",
].join("\n");

async function waitFor(path: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`${path} was not written in ${ms} ms`);
    await delay(50);
  }
}

describe("a killed run's checkout (row 023-16, D6)", SLOW, () => {
  it("is gone after the next run's sweep, with its git worktree", async () => {
    const f = fixture({ "src/a.ts": source(1), [TEST.path]: TEST_TEXT });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": source(2) });
    const made = join(f.dir, "made");
    const child = spawn(
      process.execPath,
      ["--import", TSX, CHILD, f.root, a, f.cacheRoot, made, TEST.path],
      { stdio: "ignore" },
    );
    const exited = new Promise((done) => child.once("exit", done));
    try {
      await waitFor(made, 60_000);
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
    const tree = readFileSync(made, "utf8");
    expect(existsSync(tree)).toBe(true);
    expect(f.checkouts()).toHaveLength(1);
    expect(git(f.root, "worktree", "list", "--porcelain")).toContain(`worktree ${tree}\n`);

    const install = linkInstall();
    const keys = await keysAtCommit({
      ...keying(f, install.install),
      root: f.root,
      commit: a,
      files: [TEST],
    });
    expect(keys.files.get(testFileId(TEST))).toMatchObject({ via: "walk" });
    expect(f.checkouts()).toEqual([]);
    expect(existsSync(tree)).toBe(false);
    expect(git(f.root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });
});
