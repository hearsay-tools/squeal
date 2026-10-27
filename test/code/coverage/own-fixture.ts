import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import type { V8Script } from "../../../src/core/code/coverage/index.js";

export const SHAPES = [
  "export function area(w: number, h: number): number {",
  "  if (w < 0) {",
  "    return 0;",
  "  }",
  "  return w * h;",
  "}",
  "",
  "export function neverCalled(): string {",
  '  return "no";',
  "}",
  "",
].join("\n");

export const range = (startOffset: number, endOffset: number, count: number) => ({
  startOffset,
  endOffset,
  count,
});

/** `shapes.ts` as tsx runs it: esbuild's code and map, V8's counts over the code. */
export function underLoader(dir: string, area: number, branch: number) {
  const path = join(dir, "src", "shapes.ts");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(path, SHAPES);
  const url = pathToFileURL(path).href;
  const out = transformSync(SHAPES, { loader: "ts", format: "esm", sourcemap: "external" });
  const map = JSON.parse(out.map) as { mappings: string };
  const code = out.code;
  const at = (text: string, from = 0) => code.indexOf(text, from);
  const areaStart = at("function area");
  const areaEnd = at("\n}", areaStart) + 2;
  const neverStart = at("function neverCalled");
  const neverEnd = at("\n}", neverStart) + 2;
  const script: V8Script = {
    url,
    functions: [
      { functionName: "", ranges: [range(0, code.length, 1)], isBlockCoverage: true },
      {
        functionName: "area",
        ranges: [
          range(areaStart, areaEnd, area),
          range(at("{", at("if")), at("}", at("if")) + 1, branch),
        ],
        isBlockCoverage: true,
      },
      {
        functionName: "neverCalled",
        ranges: [range(neverStart, neverEnd, 0)],
        isBlockCoverage: true,
      },
    ],
  };
  const lineLengths = code.split("\n").map((line) => line.length);
  const data = { ...map, sources: [url], sourcesContent: [SHAPES] };
  return { path, url, script, cache: { [url]: { lineLengths, data } } };
}
