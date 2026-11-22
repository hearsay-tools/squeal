import { describe, expect, it } from "vitest";
import type { CoveredFile, ExecutedSource } from "../../src/core/code/coverage/types.js";
import {
  decodeCoverageRun,
  encodeCoverageRun,
  type WireCoverageRun,
} from "../../src/core/runner-host/coverage-wire.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Spec 024 D3 (row 024-03): the files of one environment share one sources
 * map, which the wire carries once per run, not once per file.
 */

const source = (i: number): ExecutedSource => ({
  path: `src/m${i}.ts`,
  code: `export const m${i} = ${i};`,
  map: null,
  sha1: String(i),
});

const sourcesOf = (count: number, from = 0) =>
  new Map<AbsolutePath, ExecutedSource>(
    Array.from({ length: count }, (_, i) => [`/w/src/m${from + i}.ts`, source(from + i)]),
  );

const file = (i: number, sources: CoveredFile["sources"]): CoveredFile => ({
  testFile: { project: "", path: `test/t${i}.test.ts` },
  payload: `/tmp/p${i}.json`,
  sources,
});

const roundTrip = (wire: WireCoverageRun) =>
  decodeCoverageRun(JSON.parse(JSON.stringify(wire)) as WireCoverageRun);

describe("coverage wire: one sources table per distinct map", () => {
  it("sends a map shared by every file once, and decodes it as one map", () => {
    const shared = sourcesOf(400);
    const files = Array.from({ length: 50 }, (_, i) => file(i, shared));
    const wire = encodeCoverageRun({ runId: "r1", files });
    expect(wire.tables).toHaveLength(1);
    expect(wire.tables?.[0]).toHaveLength(400);
    expect(wire.sources).toHaveLength(400);
    expect(wire.files.every((f) => f.table === 0 && f.sources === undefined)).toBe(true);

    const back = roundTrip(wire);
    const first = back.files[0]?.sources;
    expect(back.files.every((f) => f.sources === first)).toBe(true);
    expect([...(first?.entries() ?? [])]).toEqual([...shared].map(([p, s]) => [p, { ...s }]));
  });

  it("grows with the modules, not with files times modules", () => {
    const shared = sourcesOf(400);
    const size = (count: number) =>
      JSON.stringify(
        encodeCoverageRun({
          runId: "r",
          files: Array.from({ length: count }, (_, i) => file(i, shared)),
        }),
      ).length;
    // 190 more files add only their own names and payload paths, about 100 bytes each.
    expect(size(200) - size(10)).toBeLessThan(190 * 120);
  });

  it("keeps maps apart, each source still once", () => {
    const a = sourcesOf(3);
    const b = new Map([...a].slice(1));
    const wire = encodeCoverageRun({ runId: "r", files: [file(0, a), file(1, b), file(2, a)] });
    expect(wire.tables).toHaveLength(2);
    expect(wire.sources).toHaveLength(3);
    expect(wire.files.map((f) => f.table)).toEqual([0, 1, 0]);

    const back = roundTrip(wire);
    expect(back.files[0]?.sources).toBe(back.files[2]?.sources);
    expect(back.files[0]?.sources).not.toBe(back.files[1]?.sources);
    expect([...(back.files[1]?.sources.keys() ?? [])]).toEqual(["/w/src/m1.ts", "/w/src/m2.ts"]);
    expect(back.files[0]?.sources.get("/w/src/m1.ts")).toBe(
      back.files[1]?.sources.get("/w/src/m1.ts"),
    );
  });

  it("decodes a wire from before the row, each file with its own entries", () => {
    const legacy = {
      runId: "old",
      sources: [source(0), source(1)],
      files: [
        {
          testFile: { project: "", path: "test/a.test.ts" },
          payload: "/tmp/a.json",
          sources: [["/w/src/m0.ts", 0]],
        },
        {
          testFile: { project: "", path: "test/b.test.ts" },
          payload: "/tmp/b.json",
          sources: [
            ["/w/src/m0.ts", 0],
            ["/w/src/m1.ts", 1],
          ],
        },
      ],
    } as unknown as WireCoverageRun;
    const back = decodeCoverageRun(legacy);
    expect(back.files.map((f) => [...f.sources.keys()])).toEqual([
      ["/w/src/m0.ts"],
      ["/w/src/m0.ts", "/w/src/m1.ts"],
    ]);
    expect(back.files[0]?.sources.get("/w/src/m0.ts")).toBe(
      back.files[1]?.sources.get("/w/src/m0.ts"),
    );
  });

  it("fails on a table that was not sent", () => {
    const wire = {
      runId: "r",
      sources: [],
      tables: [],
      files: [{ ...file(0, new Map()), sources: undefined, table: 3 }],
    };
    expect(() => decodeCoverageRun(wire as unknown as WireCoverageRun)).toThrow(/table 3/);
  });
});
