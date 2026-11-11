import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

/*
 * Spec 021 D9 (row 021-13): `remote.allowed`, a repository's veto on the
 * remote lanes its users name in their own `remote.json`.
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
    expect(DEFAULT_POLICY.remote).toEqual({ allowed: true });
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

  it("is documented with the other policy keys", () => {
    const reference = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../plugins/claude-code/skills/squeal/references/policy.md",
      ),
      "utf8",
    );
    expect(reference).toContain("| `remote.allowed` | `true` |");
  });
});
