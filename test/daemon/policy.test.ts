import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE, readPolicy } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function rootWith(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-"));
  dirs.push(dir);
  if (contents !== null) writeFileSync(join(dir, POLICY_FILE), contents);
  return dir;
}

function problems(contents: string): readonly string[] {
  return loadPolicy(rootWith(contents)).problems;
}

describe("loadPolicy (spec 001 D11)", () => {
  it("is the defaults with no problems when squeal.config.json is absent", () => {
    expect(loadPolicy(rootWith(null))).toEqual({ policy: DEFAULT_POLICY, problems: [] });
  });

  it("is the defaults for an empty object", () => {
    expect(loadPolicy(rootWith("{}"))).toEqual({ policy: DEFAULT_POLICY, problems: [] });
  });

  it("applies every given key over the defaults and keeps the rest", () => {
    const { policy, problems } = loadPolicy(
      rootWith(
        JSON.stringify({
          interrupt: { onRegression: false },
          stop: { waitMs: 1500 },
          baseline: { onStart: "lookup-only" },
          inputs: ["fixtures/**/*.json"],
          env: { allowlist: ["TZ"] },
          runner: { tierSize: 2, timeoutMs: null },
          daemon: { idleExitMinutes: 0.5 },
          store: { retentionDays: 3, maxSizeMb: 200 },
        }),
      ),
    );
    expect(problems).toEqual([]);
    expect(policy).toEqual({
      interrupt: { onRegression: false },
      stop: { blockOnKnownFailures: false, requireFullSuite: false, waitMs: 1500 },
      baseline: { onStart: "lookup-only" },
      inputs: ["fixtures/**/*.json"],
      env: { allowlist: ["TZ"] },
      runner: { tierSize: 2, timeoutMs: null },
      daemon: { idleExitMinutes: 0.5 },
      store: { retentionDays: 3, maxSizeMb: 200 },
    });
  });

  it("names an unknown key with its full path", () => {
    expect(problems('{"runner": {"tierSiz": 2}}')).toEqual(['unknown key "runner.tierSiz"']);
    expect(problems('{"intterupt": {}}')).toEqual(['unknown key "intterupt"']);
  });

  it("names runner.maxConcurrentRuns as unknown, a key no code honoured (quality X1)", () => {
    expect(problems('{"runner": {"maxConcurrentRuns": 1}}')).toEqual([
      'unknown key "runner.maxConcurrentRuns"',
    ]);
  });

  it("names a value of the wrong type with what was expected and what was found", () => {
    expect(problems('{"runner": {"tierSize": "4"}}')).toEqual([
      '"runner.tierSize" must be a positive integer, got "4"',
    ]);
    expect(problems('{"interrupt": {"onRegression": 1}}')).toEqual([
      '"interrupt.onRegression" must be true or false, got 1',
    ]);
    expect(problems('{"baseline": {"onStart": "run"}}')).toEqual([
      '"baseline.onStart" must be one of "lookup-then-run-missing", "lookup-only", got "run"',
    ]);
    expect(problems('{"inputs": "fixtures/**"}')).toEqual([
      '"inputs" must be an array of strings, or an object from test-file glob to an array of strings, got "fixtures/**"',
    ]);
    expect(problems('{"stop": {"waitMs": -1}}')).toEqual([
      '"stop.waitMs" must be a number >= 0, got -1',
    ]);
    expect(problems('{"daemon": {"idleExitMinutes": 0}}')).toEqual([
      '"daemon.idleExitMinutes" must be a number > 0, got 0',
    ]);
    expect(problems('{"runner": 4}')).toEqual(['"runner" must be an object, got 4']);
  });

  it("accepts inputs as a map from test-file glob to input globs (D11 as amended)", () => {
    const inputs = {
      "test/harness/plugin.test.ts": ["plugins/claude-code/dist/**"],
      "**/*.e2e.ts": [],
    };
    expect(loadPolicy(rootWith(JSON.stringify({ inputs })))).toEqual({
      policy: { ...DEFAULT_POLICY, inputs },
      problems: [],
    });
    expect(DEFAULT_POLICY.inputs).toEqual([]);
  });

  it("names a map of inputs whose values are not arrays of strings", () => {
    const expected =
      "must be an array of strings, or an object from test-file glob to an array of strings";
    expect(problems('{"inputs": {"test/a.test.ts": "fixtures/**"}}')).toEqual([
      `"inputs" ${expected}, got {"test/a.test.ts":"fixtures/**"}`,
    ]);
    expect(problems('{"inputs": {"test/a.test.ts": [1]}}')).toEqual([
      `"inputs" ${expected}, got {"test/a.test.ts":[1]}`,
    ]);
  });

  it("names an input glob Squeal cannot use, in either shape", () => {
    expect(problems('{"inputs": ["!fixtures/**"]}')).toEqual([
      '"inputs" has a glob Squeal cannot use: squeal: negated input glob is not supported: !fixtures/**',
    ]);
    expect(problems('{"inputs": {"/abs/*.test.ts": ["fixtures/**"]}}')).toEqual([
      '"inputs" has a glob Squeal cannot use: squeal: input glob must be relative: /abs/*.test.ts',
    ]);
    expect(problems('{"inputs": {"test/*.test.ts": ["fixtures/[a"]}}')).toEqual([
      '"inputs" has a glob Squeal cannot use: squeal: unclosed [ in input glob: fixtures/[a',
    ]);
    expect(loadPolicy(rootWith('{"inputs": ["!x"]}')).policy.inputs).toEqual([]);
  });

  it("applies the defaults for the bad keys only and keeps every good one (review S3)", () => {
    const loaded = loadPolicy(
      rootWith(
        JSON.stringify({
          stop: { waitMs: "500", blockOnKnownFailures: true },
          runner: { tierSzie: 2, timeoutMs: 1000 },
          interrupt: { onRegression: false },
        }),
      ),
    );
    expect(loaded.problems).toEqual([
      '"stop.waitMs" must be a number >= 0, got "500"',
      'unknown key "runner.tierSzie"',
    ]);
    expect(loaded.policy).toEqual({
      ...DEFAULT_POLICY,
      stop: { ...DEFAULT_POLICY.stop, blockOnKnownFailures: true },
      runner: { ...DEFAULT_POLICY.runner, timeoutMs: 1000 },
      interrupt: { onRegression: false },
    });
  });

  it("reports every problem at once", () => {
    expect(problems('{"runner": {"tierSize": 0, "x": 1}, "y": true}')).toEqual([
      '"runner.tierSize" must be a positive integer, got 0',
      'unknown key "runner.x"',
      'unknown key "y"',
    ]);
  });

  it.skipIf(process.getuid?.() === 0)(
    "never throws: bad JSON, a top level that is not an object, an unreadable file",
    () => {
      expect(loadPolicy(rootWith("{ nope"))).toEqual({
        policy: DEFAULT_POLICY,
        problems: [expect.stringMatching(/^not valid JSON/)],
      });
      expect(loadPolicy(rootWith("[]"))).toEqual({
        policy: DEFAULT_POLICY,
        problems: ["must be a JSON object, got an array"],
      });
    },
  );

  // Root reads a file of mode 000.
  it.skipIf(process.getuid?.() === 0)("never throws on a file it cannot read", () => {
    const dir = rootWith("{}");
    chmodSync(join(dir, POLICY_FILE), 0o000);
    expect(loadPolicy(dir)).toEqual({
      policy: DEFAULT_POLICY,
      problems: [expect.stringMatching(/^could not be read: .*EACCES/)],
    });
  });

  it("is what the hooks read: one loader for daemon and hooks (review S3)", () => {
    const root = rootWith('{"stop": {"waitMs": "500", "blockOnKnownFailures": true}, "x": 1}');
    expect(readPolicy(root)).toEqual(loadPolicy(root).policy);
    expect(readPolicy(root).stop).toEqual({
      ...DEFAULT_POLICY.stop,
      blockOnKnownFailures: true,
    });
  });
});
