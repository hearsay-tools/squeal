import { describe, expect, it, type TestContext } from "vitest";
import { PYTHONS } from "../../helpers/pytest-env.js";
import { failures } from "./compare.js";
// The validity path's entries, statically, so a change to one re-runs this file (`compare.test.ts`).
import "./driver.js";
import { comparisons, edited, FULL, lineOf, only, pythonsReady, SLOW } from "./self-test.js";

/*
 * The `adapter:pytest` kind (row 011-48, risk 3 of task 011-37): a change
 * to the code the pytest component bundles, its Python runtime among it,
 * passes when its changed lines ran in a case on both Pythons and every case
 * agrees, names each changed line no case ran, and fails a change of a
 * stored outcome until `PYTEST_ADAPTER_VERSION` is raised. Each comparison
 * is this checkout against itself under an overlay (`self-test.ts`).
 */

const { compare, release } = comparisons();

const RUNTIME = "src/runners/pytest/runtime/squeal_pytest.py";
const RUN = "src/runners/pytest/run/run.ts";
const VERSION = "src/runners/pytest/version.ts";

/** The uv Pythons the kind runs on, or the test skipped; on CI an absent one fails it. */
function requirePythons(ctx: TestContext): void {
  if (!pythonsReady()) ctx.skip("uv or one of its Pythons is absent");
}

const fired = (result: Awaited<ReturnType<typeof compare>>) =>
  result.alarms.filter((a) => a.fired).map((a) => a.component.name);

const OUTCOMES = only("adapter:pytest").filter((c) => c.name.startsWith("outcomes"));

describe("the pytest adapter's comparison (row 011-48)", () => {
  it(
    "passes a runtime change that every case runs and agrees on, on both Pythons",
    FULL,
    async (ctx) => {
      requirePythons(ctx);
      const cases = only("adapter:pytest");
      expect(new Set(cases.map((c) => c.kind === "adapter:pytest" && c.input.python))).toEqual(
        new Set(PYTHONS),
      );
      const result = await compare(
        edited(RUNTIME, '"pytest": pytest.__version__,', '"pytest": str(pytest.__version__),'),
        cases,
      );
      expect(fired(result)).toEqual(["pytest"]);
      expect(result.cases.filter((c) => c.baseline.error ?? c.candidate.error)).toEqual([]);
      expect(result.cases.filter((c) => !c.keysEqual || !c.outputsEqual)).toEqual([]);
      expect(failures(result, release())).toEqual([]);
    },
  );

  it(
    "names a changed runtime line and a changed adapter line that no case runs",
    SLOW,
    async (ctx) => {
      requirePythons(ctx);
      const closed = lineOf(RUNTIME, "if _out.closed:") + 1;
      const aborted = lineOf(RUN, "const onAbort = () => {") + 1;
      const result = await compare(
        {
          ...edited(
            RUNTIME,
            "    if _out.closed:\n        return\n",
            "    if _out.closed:\n        return None\n",
          ),
          ...edited(
            RUN,
            // Reordered, since esbuild would fold an equivalent constant back to the same code.
            "const onAbort = () => {\n    cancelled = true;\n    stopAll();",
            "const onAbort = () => {\n    stopAll();\n    cancelled = true;",
          ),
        },
        OUTCOMES.filter((c) => c.name.endsWith("3.13")),
      );
      expect(fired(result)).toEqual(["pytest"]);
      expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
      const failed = failures(result, release());
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatch(
        /^PYTEST_ADAPTER_VERSION \(src\/runners\/pytest\/version\.ts\): changed lines no case runs/,
      );
      expect(failed[0]).toContain(`${RUNTIME}:${closed} (baseline runtime)`);
      expect(failed[0]).toContain(`${RUNTIME}:${closed} (candidate runtime)`);
      // One of the swapped pair at each side, as the line diff pairs them.
      for (const side of ["baseline", "candidate"]) {
        expect(failed[0]).toMatch(
          new RegExp(`${RUN}:(${aborted}|${aborted + 1}) \\(${side} bundle line`),
        );
      }
    },
  );

  it(
    "fails a change of a stored outcome on both Pythons and names PYTEST_ADAPTER_VERSION, which a raise passes",
    SLOW,
    async (ctx) => {
      requirePythons(ctx);
      // A teardown error read as a pass: a stored outcome changes under one key.
      const teardown = edited(
        RUNTIME,
        '"when": report.when,\n            "outcome": report.outcome,',
        '"when": report.when,\n            "outcome": "passed" if report.when == "teardown" else report.outcome,',
      );
      const raise = edited(VERSION, 'PYTEST_ADAPTER_VERSION = "', 'PYTEST_ADAPTER_VERSION = "1');
      const result = await compare({ ...teardown, ...raise }, OUTCOMES);
      expect(fired(result)).toEqual(["pytest"]);
      expect(result.cases.filter((c) => !c.outputsEqual).map((c) => c.name)).toEqual(
        OUTCOMES.map((c) => c.name),
      );
      for (const c of result.cases) {
        expect(c.raised).toEqual([
          expect.stringMatching(
            /^run 1, validity:tests\/test_phases\.py: completed at the last release, completed at the candidate, its other outputs differing$/,
          ),
        ]);
      }
      // The raise stands on the differing cases (D6).
      expect(failures(result, release())).toEqual([]);
      // Held at the release's version, the same comparison asks for it.
      const held = result.alarms.map((a) => ({
        ...a,
        versions: { ...a.versions, candidate: a.versions.baseline },
      }));
      const failed = failures({ ...result, alarms: held }, release());
      expect(failed).toEqual(
        OUTCOMES.map((c) =>
          expect.stringMatching(
            new RegExp(
              `^adapter:pytest case "${c.name}": equal keys, different outputs .* raise PYTEST_ADAPTER_VERSION`,
            ),
          ),
        ),
      );
    },
  );
});
