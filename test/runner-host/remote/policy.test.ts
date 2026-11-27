import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

/*
 * Spec 021 D9 (row 021-13): `remote.allowed`, a repository's veto on the
 * remote lanes its users name in their own `remote.json`. Spec 021 D19 (row
 * 021-23): `requires.commands` and `remote.needsRepository`, two settings.
 * Row 021-40 (#294): `remote.alwaysLocal`, test files that never go remote.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(file: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-remote-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(file));
  return loadPolicy(dir);
}

describe("policy remote.allowed (021 D9)", () => {
  it("is true by default: the user's own setting decides", () => {
    expect(DEFAULT_POLICY.remote).toEqual({
      allowed: true,
      needsRepository: [],
      alwaysLocal: [],
      setup: null,
    });
    const { policy, problems } = load({});
    expect(problems).toEqual([]);
    expect(policy.remote.allowed).toBe(true);
  });

  it("takes false, which forbids remote lanes", () => {
    const { policy, problems } = load({ remote: { allowed: false } });
    expect(problems).toEqual([]);
    expect(policy.remote.allowed).toBe(false);
  });

  it("keeps the default with one problem for a value that is not a boolean, or an unknown key", () => {
    const wrong = load({ remote: { allowed: "no" } });
    expect(wrong.policy.remote.allowed).toBe(true);
    expect(wrong.problems).toEqual(['"remote.allowed" must be true or false, got "no"']);
    expect(load({ remote: { target: "box" } }).problems).toEqual(['unknown key "remote.target"']);
  });

  it("is documented with the other policy keys, as are D19's two settings", () => {
    const reference = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../plugins/claude-code/skills/squeal/references/policy.md",
      ),
      "utf8",
    );
    expect(reference).toContain("| `remote.allowed` | `true` |");
    expect(reference).toContain("| `requires.commands` | `[]` |");
    expect(reference).toContain("| `remote.needsRepository` | `[]` |");
    expect(reference).toContain("| `remote.alwaysLocal` | `[]` |");
  });
});

describe("policy requires.commands and remote.needsRepository (021 D19)", () => {
  it("are empty by default, each its own key", () => {
    expect(DEFAULT_POLICY.requires).toEqual({ commands: [] });
    const { policy, problems } = load({});
    expect(problems).toEqual([]);
    expect(policy.requires.commands).toEqual([]);
    expect(policy.remote.needsRepository).toEqual([]);
  });

  it("take a list of command names and a list of test-file globs", () => {
    const { policy, problems } = load({
      requires: { commands: ["git", "python3"] },
      remote: { needsRepository: ["test/git/**", "test/commit.test.ts"] },
    });
    expect(problems).toEqual([]);
    expect(policy.requires.commands).toEqual(["git", "python3"]);
    expect(policy.remote).toEqual({
      allowed: true,
      needsRepository: ["test/git/**", "test/commit.test.ts"],
      alwaysLocal: [],
      setup: null,
    });
  });

  it("leave out a bad entry with one problem each and keep the others", () => {
    const { policy, problems } = load({
      requires: { commands: ["git", "/usr/bin/python3", "-v", "two words"] },
      remote: { needsRepository: ["test/git/**", "!test/x.ts"] },
    });
    expect(policy.requires.commands).toEqual(["git"]);
    expect(policy.remote.needsRepository).toEqual(["test/git/**"]);
    expect(problems).toEqual([
      '"requires.commands[1]" must be a command name such as "git", got "/usr/bin/python3"; it is left out',
      '"requires.commands[2]" must be a command name such as "git", got "-v"; it is left out',
      '"requires.commands[3]" must be a command name such as "git", got "two words"; it is left out',
      '"remote.needsRepository[1]" has a glob Squeal cannot use: squeal: negated input glob is not supported: !test/x.ts; it is left out',
    ]);
  });

  it("keep the default for a value that is not a list of strings, and never mix: a glob is no command", () => {
    const wrong = load({ requires: { commands: "git" }, remote: { needsRepository: [1] } });
    expect(wrong.policy.requires.commands).toEqual([]);
    expect(wrong.policy.remote.needsRepository).toEqual([]);
    expect(wrong.problems).toEqual([
      '"requires.commands" must be an array of strings, got "git"',
      '"remote.needsRepository" must be an array of strings, got [1]',
    ]);
    expect(load({ requires: { repository: true } }).problems).toEqual([
      'unknown key "requires.repository"',
    ]);
    expect(load({ requires: { commands: ["test/**"] } }).policy.requires.commands).toEqual([]);
  });
});

describe("policy remote.alwaysLocal (row 021-40, #294)", () => {
  it("is empty by default and takes a list of test-file globs", () => {
    expect(load({}).policy.remote.alwaysLocal).toEqual([]);
    const { policy, problems } = load({ remote: { alwaysLocal: ["test/ps/proc-live.test.ts"] } });
    expect(problems).toEqual([]);
    expect(policy.remote.alwaysLocal).toEqual(["test/ps/proc-live.test.ts"]);
  });

  it("leaves out a glob it cannot use, with the key named, and keeps the others", () => {
    const { policy, problems } = load({ remote: { alwaysLocal: ["test/ps/**", "!test/x.ts"] } });
    expect(policy.remote.alwaysLocal).toEqual(["test/ps/**"]);
    expect(problems).toEqual([
      '"remote.alwaysLocal[1]" has a glob Squeal cannot use: squeal: negated input glob is not supported: !test/x.ts; it is left out',
    ]);
    const wrong = load({ remote: { alwaysLocal: "test/ps/**" } });
    expect(wrong.policy.remote.alwaysLocal).toEqual([]);
    expect(wrong.problems).toEqual([
      '"remote.alwaysLocal" must be an array of strings, got "test/ps/**"',
    ]);
  });
});

describe("policy remote.setup (row 026-35, spec 026 D13.1)", () => {
  it("is none by default and takes a repository-relative path, or null", () => {
    expect(DEFAULT_POLICY.remote.setup).toBeNull();
    const { policy, problems } = load({ remote: { setup: ".squeal/remote-setup.sh" } });
    expect(problems).toEqual([]);
    expect(policy.remote.setup).toBe(".squeal/remote-setup.sh");
    expect(load({ remote: { setup: null } }).policy.remote.setup).toBeNull();
  });

  it("refuses a path outside the repository, into its .git, or not a string, with the key named", () => {
    const expected =
      'null or a repository-relative path to a script, such as ".squeal/remote-setup.sh"';
    for (const value of ["/usr/local/bin/setup.sh", "../setup.sh", ".git/hooks/x", "", "a//b", 3]) {
      const { policy, problems } = load({ remote: { setup: value } });
      expect(policy.remote.setup).toBeNull();
      expect(problems).toEqual([
        `"remote.setup" must be ${expected}, got ${JSON.stringify(value)}`,
      ]);
    }
  });
});
