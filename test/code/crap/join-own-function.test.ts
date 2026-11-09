import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import type { CoverageSource } from "../../../src/core/code/coverage/types.js";
import { joinCoverage } from "../../../src/core/code/crap/join.js";
import { joinedEntries } from "../../../src/core/code/crap/match.js";

/*
 * Spec 020 D4 (row 020-04): a function joins its own V8 function or none,
 * never another's. Each source is code of this repository, and each V8
 * function is one its coverage records hold for that code, moved to line 1
 * or 2 (`src/core/reach/analyze.ts` `zero`, `test/lint/provider/starter.test.ts`
 * `site`, `test/watcher/parcel-racy.test.ts` `refuse`).
 */

type Entry = CoverageSource["functions"][number];

const bitset = (lines: readonly number[]) => {
  const bytes = new Uint8Array(1);
  for (const line of lines) {
    const at = (line - 1) >> 3;
    bytes[at] = (bytes[at] ?? 0) | (1 << ((line - 1) & 7));
  }
  return Buffer.from(bytes).toString("base64");
};

/** Each function by name: the start of the V8 function it joins, and what the join reads. */
async function joined(
  text: string,
  functions: readonly Entry[],
  lines: number[],
  covered: number[],
) {
  const source: CoverageSource = {
    path: "src/a.ts" as CoverageSource["path"],
    blob: "0".repeat(40) as CoverageSource["blob"],
    lines: bitset(lines),
    covered: bitset(covered),
    functions,
  };
  const count = await countFile(text, "typescript");
  const entries = joinedEntries(count.functions, functions);
  const out = joinCoverage(count.functions, [source]);
  return Object.fromEntries(
    count.functions.map((f, i) => [
      f.qualifiedName,
      { entry: entries[i]?.slice(0, 2).join(":") ?? null, ran: out[i]?.ran },
    ]),
  );
}

const ZERO = [
  "type Seconds<K extends string> = Record<K, number>;",
  "const zero = <K extends string>(keys: readonly K[]) =>",
  "  Object.fromEntries(keys.map((k) => [k, 0])) as Seconds<K>;",
  "",
].join("\n");

const SITE =
  "const site = (file: string | null) => ({ getFileName: () => file }) as unknown as NodeJS.CallSite;\n";

const REFUSE = [
  "  const refuse = (route: string) =>",
  "    ((path: string | number) => {",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source's own template literal
  "      reads.push(`${route} ${path}`);",
  '      throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });',
  "    }) as never;",
  "",
].join("\n");

describe("joinCoverage joins a function to its own V8 function or to none", () => {
  it("joins an arrow whose end a removed type cut short, and the callback in it, when both ran", async () => {
    const by = await joined(
      ZERO,
      [
        [2, 6, 3, 44, 1],
        [3, 26, 3, 42, 1],
      ],
      [2, 3],
      [2, 3],
    );
    expect(by).toEqual({
      zero: { entry: "2:6", ran: true },
      "zero.<map>": { entry: "3:26", ran: true },
    });
  });

  it("gives a callback V8 never compiled no V8 function, not its parent's that never ran", async () => {
    // The join before row 020-04 gave `zero.<map>` the V8 function of `zero`.
    const by = await joined(ZERO, [[2, 6, 3, 44, 0]], [2, 3], [2]);
    expect(by).toEqual({
      zero: { entry: "2:6", ran: false },
      "zero.<map>": { entry: null, ran: false },
    });
  });

  it("leaves a nested arrow unjoined, and unknown, when the only V8 function near it is its parent's", async () => {
    expect(
      await joined(
        SITE,
        [
          [1, 6, 1, 65, 1],
          [1, 41, 1, 60, 1],
        ],
        [1],
        [1],
      ),
    ).toEqual({
      site: { entry: "1:6", ran: true },
      "site.getFileName": { entry: "1:41", ran: true },
    });
    // The join before row 020-04 gave `getFileName` the V8 function of `site`, so it read ran.
    expect(await joined(SITE, [[1, 6, 1, 65, 1]], [1], [1])).toEqual({
      site: { entry: "1:6", ran: true },
      "site.getFileName": { entry: null, ran: null },
    });
  });

  it("joins an outer arrow cut short by a removed type once its inner arrow has joined", async () => {
    // The join before row 020-04 gave the inner arrow the outer's V8 function, so it read ran.
    const by = await joined(
      REFUSE,
      [
        [1, 8, 5, 4, 1],
        [1, 18, 5, 4, 0],
      ],
      [1, 2, 3, 4, 5],
      [1, 2, 5],
    );
    expect(by).toEqual({
      refuse: { entry: "1:8", ran: true },
      "refuse.<anonymous>": { entry: "1:18", ran: false },
    });
  });

  it("joins curried arrows that a removed type cut short, the inner first", async () => {
    const text = "const p = (y: number) => (x: unknown) => (x as Box).field;\n";
    const by = await joined(
      text,
      [
        [1, 6, 1, 52, 1],
        [1, 11, 1, 52, 0],
      ],
      [1],
      [1],
    );
    expect(by).toEqual({
      p: { entry: "1:6", ran: true },
      "p.<anonymous>": { entry: "1:11", ran: false },
    });
  });

  it("joins none of two V8 functions that could each be a function's own", () => {
    const fn = { range: { startLine: 1, startColumn: 11, endLine: 1, endColumn: 40 } };
    expect(
      joinedEntries(
        [fn],
        [
          [1, 4, 1, 30, 1],
          [1, 6, 1, 30, 0],
        ],
      ),
    ).toEqual([null]);
    expect(joinedEntries([fn], [[1, 4, 1, 30, 1]])).toEqual([[1, 4, 1, 30, 1]]);
  });
});
