import { rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { scratchDir } from "../ci/fixture.js";
import {
  clearStores,
  gate,
  onlyPart,
  partsDir,
  type Recorded,
  RISKY,
  recorded,
  recordInto,
  SLOW,
  sameApartFromSource,
} from "./code-gate-parts-kit.js";

/*
 * Spec 020 D13.2 (row 020-08b; reviews 0.1.427 B1 and 0.1.427-r2 B1):
 * `squeal code --base --parts` runs a file whose part ran at another
 * environment or with snapshot updates, as a gate with no parts does.
 */

/**
 * Review 0.1.427 B1: a test whose coverage of `risky` hangs on an
 * allow-listed variable, and passes either way.
 */
const PROBE: Readonly<Record<string, string>> = {
  "squeal.config.json": JSON.stringify({
    coverage: { enabled: true, exclude: ["test/**"] },
    env: { allowlist: ["PROBE_COVER"] },
  }),
  "src/risky.ts": "export function risky(n: number): string {\n  return String(n);\n}\n",
  "test/risky.test.ts": `import { expect, it } from "vitest";\nimport { risky } from "../src/risky";\n\nit("conditional coverage", () => {\n  expect(typeof risky).toBe("function");\n  if (process.env.PROBE_COVER === "yes") for (let n = 0; n < 7; n++) risky(n);\n});\n`,
};

describe("squeal code --base --parts: the part's environment (spec 020 D13.2)", () => {
  let probe: Recorded;
  let probeDir: string;
  const crap = (g: Awaited<ReturnType<typeof gate>>) =>
    g.report.functions.map((f) => [f.qualifiedName, f.state, f.crap]);
  /** The gate with `PROBE_COVER` at `value`, for its own tests and as the command's environment. */
  const gateAt = (value: string, args: readonly string[]) => {
    vi.stubEnv("PROBE_COVER", value);
    return gate(probe.root, ["src/risky.ts", ...args], process.env);
  };

  beforeAll(async () => {
    probeDir = scratchDir("gate-parts-environment");
    vi.stubEnv("PROBE_COVER", "yes");
    try {
      probe = await recorded(PROBE, { "src/risky.ts": RISKY }, probeDir);
    } finally {
      vi.unstubAllEnvs();
    }
  }, SLOW.timeout);

  afterEach(() => {
    vi.unstubAllEnvs();
    clearStores(probe?.root);
  });
  afterAll(() => rmSync(probeDir, { recursive: true, force: true }));

  it("takes a file at the environment its part ran in", SLOW, async () => {
    const ran = await gateAt("yes", ["--parts", probe.parts]);

    expect(ran.ran).toEqual([]);
    expect(ran.report.runs[0]?.from).toEqual({ "test/risky.test.ts": "parts" });
    expect([ran.code, crap(ran)]).toEqual([0, [["risky", "pass", 6]]]);
  });

  it(
    "runs a file whose allow-listed variable changed, as a gate with no parts does",
    SLOW,
    async () => {
      const fromParts = await gateAt("no", ["--parts", probe.parts]);
      clearStores(probe.root);
      const fresh = await gateAt("no", []);

      expect(fromParts.ran).toEqual(["test/risky.test.ts"]);
      expect(fresh.ran).toEqual(["test/risky.test.ts"]);
      expect([fromParts.code, crap(fromParts)]).toEqual([1, [["risky", "violation", 42]]]);
      expect(sameApartFromSource(fromParts.report)).toEqual(sameApartFromSource(fresh.report));
      expect(fromParts.stderr).toContain("allow-listed variables differ (values: PROBE_COVER)");
    },
  );

  it("runs a file whose part holds no descriptor of its project", SLOW, async () => {
    const bare = partsDir(probe.root, "no-descriptor", [
      { ...onlyPart(probe.parts), projects: [] },
    ]);

    const ran = await gateAt("yes", ["--parts", bare]);

    expect(ran.ran).toEqual(["test/risky.test.ts"]);
    expect([ran.code, crap(ran)]).toEqual([0, [["risky", "pass", 6]]]);
    expect(ran.stderr).toContain(`holds no environment of project ""`);
  });
});

/**
 * Review 0.1.427-r2 B1: a test whose coverage of `risky` hangs on Vitest's
 * snapshot update mode, and passes in every mode.
 */
const UPDATES: Readonly<Record<string, string>> = {
  ...PROBE,
  "squeal.config.json": JSON.stringify({ coverage: { enabled: true, exclude: ["test/**"] } }),
  "test/risky.test.ts": `import { expect, it } from "vitest";\nimport { risky } from "../src/risky";\n\nit("conditional coverage", () => {\n  expect(typeof risky).toBe("function");\n  if (expect.getState().snapshotState.snapshotUpdateState === "all") for (let n = 0; n < 7; n++) risky(n);\n});\n`,
};

describe("squeal code --base --parts: the part's snapshot update mode (018 D9, 020 D13.2)", () => {
  let none: Recorded;
  let updated: string;
  let updateDir: string;
  const crap = (g: Awaited<ReturnType<typeof gate>>) =>
    g.report.functions.map((f) => [f.qualifiedName, f.state, f.crap]);

  beforeAll(async () => {
    updateDir = scratchDir("gate-parts-update");
    none = await recorded(UPDATES, { "src/risky.ts": RISKY }, updateDir);
    updated = await recordInto(none.root, "parts-update", ["--update"]);
  }, SLOW.timeout);

  afterEach(() => clearStores(none?.root));
  afterAll(() => rmSync(updateDir, { recursive: true, force: true }));

  it(
    "runs a file whose part ran with snapshot updates, as a gate with no parts does",
    SLOW,
    async () => {
      expect(onlyPart(updated).projects.map((p) => p.updateSnapshot)).toEqual(["all"]);

      const fromParts = await gate(none.root, ["src/risky.ts", "--parts", updated]);
      clearStores(none.root);
      const fresh = await gate(none.root, ["src/risky.ts"]);

      expect(fromParts.ran).toEqual(["test/risky.test.ts"]);
      expect(fresh.ran).toEqual(["test/risky.test.ts"]);
      expect([fromParts.code, crap(fromParts)]).toEqual([1, [["risky", "violation", 42]]]);
      expect(sameApartFromSource(fromParts.report)).toEqual(sameApartFromSource(fresh.report));
      expect(fromParts.stderr).toContain('ran project "" with snapshot update "all"');
    },
  );

  it("takes a file whose part wrote no snapshot", SLOW, async () => {
    expect(onlyPart(none.parts).projects.map((p) => p.updateSnapshot)).toEqual(["none"]);

    const ran = await gate(none.root, ["src/risky.ts", "--parts", none.parts]);

    expect(ran.ran).toEqual([]);
    expect(ran.report.runs[0]?.from).toEqual({ "test/risky.test.ts": "parts" });
    expect([ran.code, crap(ran)]).toEqual([1, [["risky", "violation", 42]]]);
  });
});
