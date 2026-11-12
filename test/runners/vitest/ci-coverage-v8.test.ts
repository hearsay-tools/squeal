import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/*
 * Spec 020 D19.1 to D19.3 (row 020-26ab): `coverage.cjs` beside the
 * project's own coverage, against a fake Vitest instance and provider. The
 * fixture runs on Vitest 5 (`ci-record-coverage-v8.test.ts`); the kit has no
 * real Vitest 4.1, whose provider gives the payload object, so its shape is
 * tested here. On another Vitest version, or with another provider, Squeal
 * records nothing and the part says why.
 */

const load = createRequire(import.meta.url);

interface Header {
  readonly on?: true;
  readonly off?: string;
  readonly collector?: string;
  readonly collectorVersion?: string;
  readonly note?: string;
}

interface Coverage {
  runStart(specifications: readonly unknown[]): void;
  take(): void;
  end(modules: readonly unknown[]): Promise<{ header: Header; files: Map<string, unknown> }>;
}

const { startCoverage } = load("../../../src/runners/vitest/ci-runtime/coverage.cjs") as {
  startCoverage(vitest: object, settings: object): Coverage;
};

interface Batch {
  readonly coverage: string;
  readonly testFiles: readonly string[];
  readonly children?: true;
}

const { v8Batches } = load("../../../src/runners/vitest/ci-runtime/coverage-v8.cjs") as {
  v8Batches(
    vitest: object,
    dir: string,
    failed: (error: unknown) => void,
  ): { install(): string | null; take(): Batch[]; collector(): Header | null };
};

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-coverage-v8-"));
  temps.push(dir);
  return dir;
}

/** A V8 provider as `@vitest/coverage-v8` makes one: its name, version and `onAfterSuiteRun`. */
function v8Provider(version: string) {
  const seen: unknown[] = [];
  return {
    seen,
    name: "v8",
    version,
    onAfterSuiteRun(meta: unknown) {
      seen.push(meta);
      return "the provider's own result";
    },
  };
}

/** A Vitest instance with the project's coverage on, as `startCoverage` reads one. */
function vitestWith(version: string, coverage: object, provider?: object, projects: object[] = []) {
  const config = { coverage: { enabled: true, provider: "v8", ...coverage } };
  return { version, config, projects, coverageProvider: provider };
}

function settings(dir: string) {
  return {
    provider: join(dir, "provider.mjs"),
    worker: { script: join(dir, "w.mjs") },
    dir,
    root: dir,
  };
}

const script = (url: string, extended = false) => ({
  url,
  functions: [],
  ...(extended ? { isExtendedContext: true } : {}),
});

describe("ci record beside the project's V8 provider (spec 020 D19)", () => {
  it("writes Vitest 4.1's payload object to a file and returns the provider's result", () => {
    const dir = temp();
    const provider = v8Provider("4.1.10");
    const failed: unknown[] = [];
    const batches = v8Batches(vitestWith("4.1.10", {}, provider), dir, (e) => failed.push(e));
    expect(batches.install()).toBeNull();
    const payload = { result: [script("file:///p/src/a.ts")] };
    const meta = { coverage: payload, testFiles: ["test/a.test.ts"], projectName: "" };
    expect(provider.onAfterSuiteRun(meta)).toBe("the provider's own result");
    expect(provider.seen).toEqual([meta]);
    const [batch, ...rest] = batches.take();
    expect(rest).toEqual([]);
    expect(batch?.testFiles).toEqual(["test/a.test.ts"]);
    expect(batch?.children).toBeUndefined();
    expect(JSON.parse(readFileSync(batch?.coverage ?? "", "utf8"))).toEqual(payload);
    expect(batches.collector()).toEqual({ collector: "v8", collectorVersion: "4.1.10" });
    expect(failed).toEqual([]);
  });

  it("reads Vitest 5's payload path in place, and marks a child process's scripts", () => {
    const dir = temp();
    const provider = v8Provider("5.0.3");
    const vitest = vitestWith("5.0.3", { autoAttachSubprocess: true }, provider);
    const batches = v8Batches(vitest, dir, () => {});
    batches.install();
    const own = join(dir, "own.json");
    const child = join(dir, "child.json");
    writeFileSync(own, JSON.stringify({ result: [script("file:///p/src/a.ts")] }));
    writeFileSync(child, JSON.stringify({ result: [script("file:///p/src/c.mjs", true)] }));
    provider.onAfterSuiteRun({ coverage: own, testFiles: ["a.test.ts"] });
    provider.onAfterSuiteRun({ coverage: child, testFiles: ["c.test.ts"] });
    const taken = batches.take();
    expect(taken.map((b) => [b.coverage, b.children])).toEqual([
      [own, undefined],
      [child, true],
    ]);
  });

  it("keeps the provider's result when Squeal cannot read a payload", () => {
    const provider = v8Provider("5.0.3");
    const failed: unknown[] = [];
    const batches = v8Batches(vitestWith("5.0.3", {}, provider), temp(), (e) => failed.push(e));
    batches.install();
    expect(provider.onAfterSuiteRun({ coverage: undefined })).toBe("the provider's own result");
    expect(batches.take()).toEqual([]);
    expect(String(failed[0])).toContain("a V8 payload of type undefined");
  });

  it("names the collector in the header once the provider is wrapped", async () => {
    const dir = temp();
    const provider = v8Provider("5.0.3");
    const coverage = startCoverage(vitestWith("5.0.3", {}, provider), settings(dir));
    coverage.runStart([]);
    const ended = await coverage.end([]);
    expect(ended.header).toEqual({ on: true, collector: "v8", collectorVersion: "5.0.3" });
  });

  it.each([
    [
      "an untested Vitest version",
      vitestWith("4.0.18", {}, v8Provider("4.0.18")),
      "the run has V8 coverage of its own on Vitest 4.0.18; Squeal records from it only on Vitest 4.1 and 5.0, the versions it has tested",
    ],
    [
      "the Istanbul provider",
      vitestWith("5.0.3", { provider: "istanbul" }),
      'the run has coverage of its own with provider "istanbul", from which Squeal records nothing (it reads only the V8 provider\'s), and a Vitest run takes one coverage provider',
    ],
    [
      "browser mode",
      vitestWith("5.0.3", {}, undefined, [{ config: { browser: { enabled: true } } }]),
      "the run has V8 coverage of its own in browser mode, which Squeal does not read",
    ],
  ])("yields to %s and names why", async (_, vitest, note) => {
    const coverage = startCoverage(vitest, settings(temp()));
    coverage.runStart([]);
    const ended = await coverage.end([]);
    expect(ended).toEqual({ header: { off: "project-coverage", note }, files: new Map() });
  });

  it("yields to a provider whose version Squeal has not tested, and leaves it unwrapped", async () => {
    const provider = v8Provider("5.1.0");
    const original = provider.onAfterSuiteRun;
    const coverage = startCoverage(vitestWith("5.0.3", {}, provider), settings(temp()));
    coverage.runStart([]);
    expect(provider.onAfterSuiteRun).toBe(original);
    const ended = await coverage.end([]);
    expect(ended.header).toEqual({
      off: "project-coverage",
      note: "the run's V8 provider is version 5.1.0; Squeal records from it only on Vitest 4.1 and 5.0, the versions it has tested",
    });
  });

  it("says the run had coverage of its own when Squeal has no records' worker", async () => {
    const off = { off: "no-provider", note: "this Squeal has no coverage/provider.mjs" };
    const coverage = startCoverage(vitestWith("5.0.3", {}, v8Provider("5.0.3")), off);
    const ended = await coverage.end([]);
    expect(ended.header).toEqual({
      off: "project-coverage",
      note: "the run has V8 coverage of its own, and this Squeal has no coverage/provider.mjs",
    });
  });
});
