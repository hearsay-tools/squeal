import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBasePolicy, readBasePolicy } from "../../../src/core/code/gate/policy.js";
import { readScope } from "../../../src/core/code/gate/scope.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

/* Spec 020 D6: the gate's policy is `squeal.config.json` at the base commit. */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const DEFAULTS = {
  complexityThreshold: 20,
  crapThreshold: 30,
  coverageExclude: [],
  include: DEFAULT_POLICY.complexity.include,
  exclude: DEFAULT_POLICY.complexity.exclude,
  maxFileBytes: 524_288,
  children: false,
  scope: readScope(DEFAULT_POLICY).base,
};

/** A repository whose first commit holds `config` as `squeal.config.json` (none when `null`); returns it and that commit. */
function repo(config: string | null): {
  root: string;
  base: string;
  commit: (text: string) => void;
} {
  const root = mkdtempSync(join(tmpdir(), "squeal-gate-base-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
  if (config !== null) writeFileSync(join(root, "squeal.config.json"), config);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "base");
  const commit = (text: string) => {
    writeFileSync(join(root, "squeal.config.json"), text);
    git("add", ".");
    git("commit", "-qm", "branch");
  };
  return { root, base: git("rev-parse", "HEAD"), commit };
}

describe("readBasePolicy", () => {
  it("reads the defaults when the base has no squeal.config.json", async () => {
    const { root, base } = repo(null);

    expect(await loadBasePolicy(root, base)).toEqual({ policy: DEFAULTS, problems: [] });
  });

  it("reads the thresholds, coverage.exclude and the count keys at the base, not the enabled keys", async () => {
    const { root, base } = repo(
      JSON.stringify({
        complexity: {
          enabled: false,
          threshold: 12,
          include: ["src/**"],
          exclude: ["src/gen/**"],
          maxFileBytes: 900,
        },
        coverage: { enabled: false, exclude: ["test/**"] },
        crap: { enabled: false, threshold: 25 },
      }),
    );

    expect(await readBasePolicy(root, base)).toEqual({
      complexityThreshold: 12,
      crapThreshold: 25,
      coverageExclude: ["test/**"],
      include: ["src/**"],
      exclude: ["src/gen/**"],
      maxFileBytes: 900,
      children: false,
      scope: DEFAULTS.scope,
    });
  });

  it("reads coverage.children at the base, with coverage.enabled off too (D12.1)", async () => {
    const { root, base } = repo(JSON.stringify({ coverage: { enabled: false, children: true } }));

    expect(await readBasePolicy(root, base)).toEqual({ ...DEFAULTS, children: true });
  });

  it("does not read coverage.children a branch turns on, committed or in the working tree", async () => {
    const { root, base, commit } = repo(null);
    const on = JSON.stringify({ coverage: { children: true } });
    commit(on);
    writeFileSync(join(root, "squeal.config.json"), on);

    expect((await readBasePolicy(root, base)).children).toBe(false);
  });

  it("does not read a branch's looser config, committed or in the working tree", async () => {
    const strict = { complexity: { threshold: 10 }, crap: { threshold: 15 } };
    const { root, base, commit } = repo(JSON.stringify(strict));
    const loose = JSON.stringify({
      complexity: { threshold: 99 },
      crap: { threshold: 999 },
      coverage: { exclude: ["**"] },
    });
    commit(loose);
    writeFileSync(join(root, "squeal.config.json"), loose);

    expect(await readBasePolicy(root, base)).toEqual({
      ...DEFAULTS,
      complexityThreshold: 10,
      crapThreshold: 15,
    });
  });

  it("reads the defaults with the loader's problems for a base file that is not JSON or has a wrong key", async () => {
    const broken = repo("{ not json");
    const wrong = repo(JSON.stringify({ crap: { threshold: "high" } }));

    const fromBroken = await loadBasePolicy(broken.root, broken.base);
    const fromWrong = await loadBasePolicy(wrong.root, wrong.base);

    expect(fromBroken.policy).toEqual(DEFAULTS);
    expect(fromBroken.problems).toEqual([expect.stringContaining("not valid JSON")]);
    expect(fromWrong.policy).toEqual(DEFAULTS);
    expect(fromWrong.problems).toEqual([expect.stringContaining("crap.threshold")]);
  });

  it("reads checks and gate.groups at the base, a name no test group has a problem (D14.1)", async () => {
    const checks = [{ name: "browser", runner: "vitest", project: "browser", at: "manual" }];
    const { root, base, commit } = repo(
      JSON.stringify({ checks, gate: { groups: ["tests", "browserr"] } }),
    );
    commit(JSON.stringify({ checks: [{ ...checks[0], at: "edit" }] }));

    const { policy, problems } = await loadBasePolicy(root, base);

    expect(policy.scope?.configured).toEqual(["tests"]);
    expect(policy.scope?.groups.map((g) => [g.name, g.at])).toEqual([
      ["browser", "manual"],
      ["tests", "edit"],
      ["slow", "edit"],
    ]);
    expect(problems).toEqual([
      expect.stringMatching(/^gate\.groups: "browserr" names no test group/),
    ]);
  });

  it("reports a gate.groups that is not a list as a problem, and reads it unset", async () => {
    const { root, base } = repo(JSON.stringify({ gate: { groups: "browser" } }));

    const { policy, problems } = await loadBasePolicy(root, base);

    expect(policy.scope?.configured).toBeNull();
    expect(problems).toEqual([expect.stringContaining("gate.groups")]);
  });

  it("leaves no scratch file under $TMPDIR", async () => {
    const { root, base } = repo(JSON.stringify({ crap: { threshold: 25 } }));
    const scratch = () =>
      readdirSync(tmpdir()).filter((name) => name.startsWith("squeal-gate-policy-"));
    const before = scratch();

    await readBasePolicy(root, base);

    expect(scratch()).toEqual(before);
  });
});
