/*
 * Source files the end-to-end harness writes into the fixture repository
 * (`test/fixtures/e2e`), at `SOURCE_PATH`. Each write gets a counter comment
 * from the harness, because content-keyed lookups make content seen before
 * instant: `//` in TypeScript, `#` in Python.
 */

/** `test/slow.test.ts` sleeps this long per run, so a hook can fire while it is in flight. */
export const SLOW_MS = 5_000;

export type Source = "math" | "strings" | "slow" | "demo" | "rates" | "resources";

/** Where each source lives in the fixture repository. */
export const SOURCE_PATH: Readonly<Record<Source, string>> = {
  math: "src/math.ts",
  strings: "src/strings.ts",
  slow: "src/slow.ts",
  demo: "packages/demo/src/math.ts",
  rates: "python/billing/src/billing/rates.py",
  resources: "python/small/src/app/resources.py",
};

/** `src/math.ts`: `test/math.test.ts` checks `add(1, 2)` is 3 and `mul(2, 3)` is 6. */
export const MATH = (add: "+" | "-" = "+", mul: "*" | "+" = "*") =>
  `export const add = (a: number, b: number) => a ${add} b;\n` +
  `export const mul = (a: number, b: number) => a ${mul} b;\n`;

/** `src/strings.ts`: `test/strings.test.ts` checks `shout("hi")` is "HI!". */
export const STRINGS = (suffix: "!" | "?" = "!") =>
  `export const shout = (s: string) => \`\${s.toUpperCase()}${suffix}\`;\n`;

/** `src/slow.ts`: `test/slow.test.ts` sleeps `SLOW_MS`, then checks `double(2)` is 4. */
export const SLOW = (factor: 2 | 3 = 2) =>
  `export const SLOW_MS = ${SLOW_MS};\nexport const double = (n: number) => n * ${factor};\n`;

/**
 * `packages/demo/src/math.ts` of the node:test fixture: only
 * `packages/demo/test/unit/math.test.ts` imports it, and checks `add(2, 3)` is 5.
 */
export const DEMO = (add: "+" | "-" = "+") =>
  `export const add = (a: number, b: number): number => a ${add} b;\n`;

/**
 * `python/billing/src/billing/rates.py` of the pytest fixture (spec 007):
 * `tests/test_invoice.py` and `tests/test_tax.py` import it, `tests/test_fmt.py`
 * does not; both expect a 20 percent tax. The raised rate is longer than the
 * counter's width can make up: Python reuses a module's cached bytecode when
 * the source keeps its size within one second (007-17 report, defect 1).
 */
export const RATES = (percent: 20 | 25 = 20) =>
  `RATE_PERCENT = ${percent}${percent === 20 ? "" : "  # raised"}\n\n\ndef tax(net):\n    return net * RATE_PERCENT // 100\n`;

/**
 * `python/small/src/app/resources.py`, `test/fixtures/pytest/small`'s own
 * with `values()` overridden by `a` when given: `tests/test_resources.py`
 * expects `{"a": 1}`.
 */
export const RESOURCES = (a?: 2) =>
  "import json\nfrom importlib import resources\n\ndef values():\n" +
  '    found = json.loads(resources.files("app.data").joinpath("values.json").read_text())\n' +
  (a === undefined ? "    return found\n" : `    return {**found, "a": ${a}}\n`);
