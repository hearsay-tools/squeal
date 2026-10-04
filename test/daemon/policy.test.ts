import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE, PolicyError } from "../../src/core/daemon/policy.js";
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

function problems(contents: string): string {
  try {
    loadPolicy(rootWith(contents));
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyError);
    return (error as Error).message;
  }
  throw new Error("expected a PolicyError");
}

describe("loadPolicy (spec 001 D11)", () => {
  it("is the defaults when squeal.config.json is absent", () => {
    expect(loadPolicy(rootWith(null))).toEqual(DEFAULT_POLICY);
  });

  it("is the defaults for an empty object", () => {
    expect(loadPolicy(rootWith("{}"))).toEqual(DEFAULT_POLICY);
  });

  it("applies every given key over the defaults and keeps the rest", () => {
    const policy = loadPolicy(
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
    expect(policy).toEqual({
      interrupt: { onRegression: false },
      stop: { blockOnKnownFailures: false, requireFullSuite: false, waitMs: 1500 },
      baseline: { onStart: "lookup-only" },
      inputs: ["fixtures/**/*.json"],
      env: { allowlist: ["TZ"] },
      runner: { tierSize: 2, timeoutMs: null, maxConcurrentRuns: 1 },
      daemon: { idleExitMinutes: 0.5 },
      store: { retentionDays: 3, maxSizeMb: 200 },
    });
  });

  it("names an unknown key with its full path", () => {
    expect(problems('{"runner": {"tierSiz": 2}}')).toContain('unknown key "runner.tierSiz"');
    expect(problems('{"intterupt": {}}')).toContain('unknown key "intterupt"');
  });

  it("names a value of the wrong type with what was expected and what was found", () => {
    expect(problems('{"runner": {"tierSize": "4"}}')).toContain(
      '"runner.tierSize" must be a positive integer, got "4"',
    );
    expect(problems('{"interrupt": {"onRegression": 1}}')).toContain(
      '"interrupt.onRegression" must be true or false, got 1',
    );
    expect(problems('{"baseline": {"onStart": "run"}}')).toContain(
      '"baseline.onStart" must be one of "lookup-then-run-missing", "lookup-only", got "run"',
    );
    expect(problems('{"inputs": "fixtures/**"}')).toContain(
      '"inputs" must be an array of strings, got "fixtures/**"',
    );
    expect(problems('{"stop": {"waitMs": -1}}')).toContain(
      '"stop.waitMs" must be a number >= 0, got -1',
    );
    expect(problems('{"daemon": {"idleExitMinutes": 0}}')).toContain(
      '"daemon.idleExitMinutes" must be a number > 0, got 0',
    );
    expect(problems('{"runner": 4}')).toContain('"runner" must be an object, got 4');
  });

  it("reports every problem at once, prefixed with the file path", () => {
    const message = problems('{"runner": {"tierSize": 0, "x": 1}, "y": true}');
    expect(message).toMatch(/squeal\.config\.json/);
    expect(message).toContain('"runner.tierSize" must be a positive integer, got 0');
    expect(message).toContain('unknown key "runner.x"');
    expect(message).toContain('unknown key "y"');
  });

  it("reports a JSON syntax error and a top level that is not an object", () => {
    expect(problems("{ nope")).toMatch(/not valid JSON/);
    expect(problems("[]")).toContain("must be a JSON object");
  });
});
