/*
 * Source files the end-to-end harness writes into the fixture repository
 * (`test/fixtures/e2e`), at `SOURCE_PATH`. Each write gets a counter comment
 * from the harness, because content-keyed lookups make content seen before
 * instant.
 */

/** `test/slow.test.ts` sleeps this long per run, so a hook can fire while it is in flight. */
export const SLOW_MS = 5_000;

export type Source = "math" | "strings" | "slow" | "demo";

/** Where each source lives in the fixture repository. */
export const SOURCE_PATH: Readonly<Record<Source, string>> = {
  math: "src/math.ts",
  strings: "src/strings.ts",
  slow: "src/slow.ts",
  demo: "packages/demo/src/math.ts",
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
