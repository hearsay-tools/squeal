import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import { buildRecord, type V8Script } from "../../../src/core/code/coverage/index.js";
import { joinCoverage } from "../../../src/core/code/crap/join.js";
import { covering } from "../../runners/vitest/coverage-helpers.js";
import { openFixture, ref, SLOW } from "../../runners/vitest/helpers.js";
import { SOURCE } from "./fixture.js";

/*
 * Review 0.1.297 B4 (repair R6): the join on records Squeal's provider
 * makes on the Node that runs this file, Node 22 and Node 24 in CI. V8
 * leaves out a function it never compiled, such as an arrow in a field of
 * a class never constructed, and the line it is on can run outside it: no
 * function is read as run from such a line.
 */

const LAZY = `export class Never { a() { return 1; } b() { return 2; } }
export class Fields { a = () => 1; b = () => 2; }
export function outer() { const inner = () => 1; return inner; }
export class One { only = () => 1; }
`;

/** A test file that imports `src/<name>.ts` as `mod` and runs `body`. */
const testOf = (name: string, body: string) =>
  [
    'import { expect, it } from "vitest";',
    `import * as mod from "../src/${name}.js";`,
    `it("runs", () => {`,
    `  ${body}`,
    "});",
    "",
  ].join("\n");

/** The functions of `src/<name>.ts` (`text`) that a run of `body` ran, by the join. */
async function ranBy(name: string, text: string, body: string) {
  const opened = covering();
  const test = `test/${name}.test.ts`;
  const fx = await openFixture(
    "own-provider",
    { [`src/${name}.ts`]: text, [test]: testOf(name, body) },
    opened.create,
  );
  const report = await fx.adapter.run([ref(test)], fx.runOptions());
  expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
  const file = opened.runs[0]?.files.find((f) => f.testFile.path === test);
  if (file === undefined) throw new Error("no payload");
  const payload = (JSON.parse(readFileSync(file.payload, "utf8")) as { result: V8Script[] }).result;
  const record = buildRecord(file, payload, "sha1", new Map());
  const source = record.sources.find((s) => s.path === `src/${name}.ts`);
  if (source === undefined) throw new Error(`no entry for src/${name}.ts`);
  const count = await countFile(text, "typescript");
  const joined = joinCoverage(count.functions, [source]);
  return {
    names: count.functions.map((f) => f.qualifiedName),
    ran: count.functions.flatMap((f, i) => (joined[i]?.ran === true ? [f.qualifiedName] : [])),
    unknown: count.functions.flatMap((f, i) => (joined[i]?.ran === null ? [f.qualifiedName] : [])),
    entries: source.functions,
  };
}

describe(
  `the join on real records, Node ${process.versions.node} (review 0.1.297 B4)`,
  SLOW,
  () => {
    it("reads no function of a module only imported as run", async () => {
      const by = await ranBy("lazy", LAZY, 'expect(typeof mod.outer).toBe("function");');
      expect(by.names).toEqual([
        "Never.a",
        "Never.b",
        "Fields.a",
        "Fields.b",
        "outer",
        "outer.inner",
        "One.only",
      ]);
      expect({ ran: by.ran, entries: by.entries }).toMatchObject({ ran: [] });
      // A zero-hit field initializer or `outer` tells its arrows never ran, on either engine.
      expect(by.unknown).toEqual([]);
    });

    it("reads the field arrows of a class constructed and never called as not run", async () => {
      const by = await ranBy("lazy", LAZY, "expect(new mod.Fields()).toBeDefined();");
      expect({ ran: by.ran, entries: by.entries }).toMatchObject({ ran: [] });
    });

    it("reads a called field arrow and the function it came from as run", async () => {
      const by = await ranBy("lazy", LAZY, "expect(new mod.Fields().b() + mod.outer()()).toBe(3);");
      expect({ ran: by.ran, entries: by.entries }).toMatchObject({
        ran: ["Fields.b", "outer", "outer.inner"],
      });
    });

    it("keeps the arrow, the nested callback, the early return and the class method", async () => {
      const by = await ranBy(
        "math",
        SOURCE,
        "expect([mod.add(1, 2), mod.branchy(20), mod.twice([]), new mod.Counter().increment()]).toBeDefined();",
      );
      expect({ ran: by.ran, entries: by.entries }).toMatchObject({
        ran: ["add", "twice", "branchy", "Counter.increment"],
      });
    });
  },
);
