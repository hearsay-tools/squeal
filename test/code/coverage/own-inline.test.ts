import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CachedSourceMap } from "../../../src/core/code/coverage/index.js";
import { ownRecord } from "../../../src/core/code/coverage/own.js";
import { SHAPES, underLoader } from "./own-fixture.js";

// Row 015-95: Node 24.22.1 serializes lazy maps as null data plus a retained URL.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-inline-")));
  dirs.push(dir);
  return { dir, ...underLoader(dir, 1, 0) };
}
const inline = (data: unknown) =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString("base64")}`;

describe("retained inline maps (row 015-95)", () => {
  it.each(["base64", "percent"])("uses original text from a %s map after an edit", (encoding) => {
    const { dir, path, url, script, cache } = fixture();
    const entry = cache[url];
    if (entry === undefined) throw new Error("no cached map");
    const expected = ownRecord(dir, { result: [script], "source-map-cache": cache }, "sha1");
    const mapURL =
      encoding === "base64"
        ? inline(entry.data)
        : `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(entry.data))}`;
    writeFileSync(path, "export const nowEdited = 1;\n");
    expect(
      ownRecord(
        dir,
        {
          result: [script],
          "source-map-cache": { [url]: { ...entry, data: null, url: mapURL } },
        },
        "sha1",
      ),
    ).toEqual(expected);
  });

  it.each([
    ["missing map URL", () => ({ data: null })],
    ["external file map", () => ({ data: null, url: "shapes.ts.map" })],
    ["network map", () => ({ data: null, url: "https://example.test/map.json" })],
    ["invalid JSON", () => ({ data: null, url: inline("not a map") })],
    ["malformed JSON", () => ({ data: null, url: "data:application/json;base64,ew==" })],
    ["invalid base64", () => ({ data: null, url: "data:application/json;base64,@@@" })],
    ["invalid percent encoding", () => ({ data: null, url: "data:application/json,%FF" })],
    ["unsupported media type", () => ({ data: null, url: "data:text/plain,%7B%7D" })],
    [
      "missing original text",
      (data) => ({ data: null, url: inline({ ...data, sourcesContent: [null] }) }),
    ],
    [
      "different source",
      (data) => ({ data: null, url: inline({ ...data, sources: ["file:///other.ts"] }) }),
    ],
    ["unsupported version", (data) => ({ data: null, url: inline({ ...data, version: 2 }) })],
    ["indexed map", () => ({ data: null, url: inline({ version: 3, sections: [] }) })],
    ["invalid mappings", (data) => ({ data: null, url: inline({ ...data, mappings: "!" }) })],
    ["empty mapping segment", (data) => ({ data: { ...data, mappings: "AAAA,,AAAA" } })],
    ["leading empty segment", (data) => ({ data: { ...data, mappings: ",AAAA" } })],
    ["trailing empty segment", (data) => ({ data: { ...data, mappings: "AAAA," } })],
    ["negative source line", (data) => ({ data: { ...data, mappings: "AADA" } })],
    ["negative source column", (data) => ({ data: { ...data, mappings: "AAAD" } })],
    ["out-of-bounds generated column", (data) => ({ data: { ...data, mappings: "ggEAAA" } })],
    ["unfinished VLQ", (data) => ({ data: null, url: inline({ ...data, mappings: "g" }) })],
    ["invalid segment", (data) => ({ data: null, url: inline({ ...data, mappings: "AA" }) })],
    [
      "non-UTF-8 JSON",
      () => ({
        data: null,
        url: `data:application/json;base64,${Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]).toString("base64")}`,
      }),
    ],
    [
      "multiple sources",
      (data) => ({ data: { ...data, sources: ["file:///a.ts", "file:///b.ts"] } }),
    ],
    ["nonempty source root", (data) => ({ data: { ...data, sourceRoot: "elsewhere/" } })],
    ["foreign mapping source", (data) => ({ data: { ...data, mappings: "ACAA" } })],
    ["overflowing VLQ", (data) => ({ data: { ...data, mappings: "ggggggggAAAA" } })],
    ["negative line length", () => ({ lineLengths: [-1] })],
    ["missing line lengths", () => ({ lineLengths: null })],
    ["too many generated lines", () => ({ lineLengths: Array(250_001).fill(0) })],
    [
      "oversized URL",
      () => ({ data: null, url: `data:application/json,${" ".repeat(16 * 1024 * 1024)}` }),
    ],
    [
      "oversized parsed map",
      (data) => ({ data: { ...data, mappings: "A".repeat(16 * 1024 * 1024 + 1) } }),
    ],
    [
      "too many mapping segments",
      (data) => ({ data: { ...data, mappings: `${"AAAA,".repeat(250_000)}AAAA` } }),
    ],
    ["wrong parsed identity", (data) => ({ data: { ...data, sources: ["file:///other.ts"] } })],
    ["invalid parsed mappings", (data) => ({ data: { ...data, mappings: 1 } })],
  ] satisfies readonly (readonly [string, (data: object) => object])[])(
    "leaves %s unread",
    (_name, change) => {
      const { dir, path, url, script, cache } = fixture();
      const entry = cache[url];
      if (entry === undefined) throw new Error("no cached map");
      // A later disk map is no more proof of execution than a replacement source.
      writeFileSync(`${path}.map`, JSON.stringify(entry.data));
      writeFileSync(path, `${SHAPES}\n//# sourceMappingURL=shapes.ts.map\n`);
      const cached = { ...entry, ...change(entry.data) } as CachedSourceMap;
      expect(
        ownRecord(
          dir,
          {
            result: [script],
            "source-map-cache": { [url]: cached },
          },
          "sha1",
        ),
      ).toEqual({ v: 1, sources: [], unread: ["src/shapes.ts"] });
    },
  );
});
