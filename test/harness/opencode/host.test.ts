import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findNode,
  meetsMinimum,
  nodeOnPath,
  usesSquealAt,
} from "../../../src/harness/opencode/host.js";
import { tempDir } from "../../store/helpers.js";
import { outsideGit } from "../bundle-helpers.js";

/*
 * Spec 008 D4: the plugin's init checks, in OpenCode's process. The fast path
 * answers as 001 D9's `sh` test in the Claude Code plugin's hooks.json does,
 * on the same layouts.
 */

/** The `s()` function of hooks.json's per-tool fast path. */
const SH_TEST = (() => {
  const hooks = readFileSync(
    resolve(import.meta.dirname, "../../../plugins/claude-code/hooks/hooks.json"),
    "utf8",
  );
  const match = /s\(\) \{.*?\[ -e \\"\$g\/squeal\\" \]; \}/.exec(hooks);
  if (match === null) throw new Error("hooks.json has no fast-path s()");
  return JSON.parse(`"${match[0]}"`) as string;
})();

const shSays = (dir: string): boolean => {
  try {
    execFileSync("sh", ["-c", `${SH_TEST}; s "$1"`, "sh", dir], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Layouts: a main checkout and a linked worktree, each with and without a store or a config. */
function layouts(): Record<string, string> {
  // Under /tmp: the test temp dir can sit inside this checkout, whose repository uses Squeal.
  const base = outsideGit();
  const at = (...parts: string[]) => {
    const dir = join(base, ...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const plain = at("plain");
  mkdirSync(join(plain, ".git"));
  at("plain", "src");
  const store = at("store");
  mkdirSync(join(store, ".git", "squeal"), { recursive: true });
  at("store", "src", "deep");
  const config = at("config");
  mkdirSync(join(config, ".git"));
  writeFileSync(join(config, "squeal.config.json"), "{}\n");
  at("config", "pkg");
  // A linked worktree of `store`, its gitdir relative, its commondir relative to that.
  const linked = at("linked");
  const gitdir = at("store", ".git", "worktrees", "linked");
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}\n`);
  at("linked", "sub");
  // A linked worktree of `plain`: no store anywhere.
  const linkedPlain = at("linked-plain");
  const plainGitdir = at("plain", ".git", "worktrees", "lp");
  writeFileSync(join(plainGitdir, "commondir"), "../..\n");
  writeFileSync(join(linkedPlain, ".git"), "gitdir: ../plain/.git/worktrees/lp\n");
  return {
    "plain/src": join(plain, "src"),
    "store/src/deep": join(store, "src", "deep"),
    "config/pkg": join(config, "pkg"),
    "linked/sub": join(linked, "sub"),
    "linked-plain": linkedPlain,
    "no git": outsideGit(),
  };
}

describe("usesSquealAt", () => {
  it("answers as hooks.json's sh fast path on every layout", () => {
    const answers = Object.entries(layouts()).map(([name, dir]) => [
      name,
      usesSquealAt(dir),
      shSays(dir),
    ]);
    for (const [name, ours, sh] of answers) expect(ours, String(name)).toBe(sh);
    expect(Object.fromEntries(answers.map(([name, ours]) => [name, ours]))).toEqual({
      "plain/src": false,
      "store/src/deep": true,
      "config/pkg": true,
      "linked/sub": true,
      "linked-plain": false,
      "no git": false,
    });
  });

  it("is false for an empty or missing directory, without throwing", () => {
    expect(usesSquealAt("")).toBe(false);
    expect(usesSquealAt("/no/such/dir/anywhere")).toBe(false);
  });
});

describe("finding Node", () => {
  it("takes the first executable node on PATH", () => {
    const empty = tempDir("squeal-oc-path-");
    const notExecutable = tempDir("squeal-oc-path-");
    writeFileSync(join(notExecutable, "node"), "");
    const found = tempDir("squeal-oc-path-");
    writeFileSync(join(found, "node"), "#!/bin/sh\n");
    chmodSync(join(found, "node"), 0o755);
    expect(nodeOnPath(["", empty, notExecutable, found].join(":"))).toBe(join(found, "node"));
    expect(nodeOnPath(empty)).toBeNull();
    expect(nodeOnPath(undefined)).toBeNull();
  });

  it("holds Node to Squeal's minimum, 22.13", () => {
    expect(meetsMinimum("22.13.0")).toBe(true);
    expect(meetsMinimum("24.3.0\n")).toBe(true);
    expect(meetsMinimum("22.12.9")).toBe(false);
    expect(meetsMinimum("20.19.0")).toBe(false);
    expect(meetsMinimum("garbage")).toBe(false);
  });

  it("finds this Node on a PATH holding it, and none below the minimum", async () => {
    const dir = tempDir("squeal-oc-node-");
    writeFileSync(join(dir, "node"), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
    chmodSync(join(dir, "node"), 0o755);
    expect(await findNode({ PATH: dir })).toBe(join(dir, "node"));
    const old = tempDir("squeal-oc-node-");
    writeFileSync(join(old, "node"), "#!/bin/sh\necho 20.19.0\n");
    chmodSync(join(old, "node"), 0o755);
    expect(await findNode({ PATH: old })).toBeNull();
    expect(await findNode({ PATH: tempDir("squeal-oc-node-") })).toBeNull();
  });
});
