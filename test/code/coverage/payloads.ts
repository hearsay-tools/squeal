import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CoveredFile,
  ExecutedSource,
  V8Script,
} from "../../../src/core/code/coverage/index.js";

/*
 * Row 015-42: synthetic V8 payloads of a size the records' writer meets in
 * this repository (011-197: hundreds of sources per test file). Each
 * source, its bytes its own, is its own code with a map of one segment per
 * line, and each line holds one V8 function with a block range.
 */

export interface PayloadSet {
  readonly dir: string;
  /** One test file's covered file; its payload is a new link to the same bytes. */
  file(path?: string): CoveredFile;
  readonly sources: ReadonlyMap<string, ExecutedSource>;
  /** The payload's scripts, as the provider wrote them. */
  readonly scripts: readonly V8Script[];
  /** The payload's size in bytes. */
  readonly bytes: number;
  cleanup(): void;
}

const VLQ = "AACA";

export function payloads(sourceCount: number, lines: number): PayloadSet {
  const dir = mkdtempSync(join(tmpdir(), "sq-payloads-"));
  const sources = new Map<string, ExecutedSource>();
  const scripts: V8Script[] = [];
  for (let s = 0; s < sourceCount; s++) {
    const text = Array.from(
      { length: lines },
      (_, l) => `export function f${l}(a) { if (a > ${l}) return a; return ${s}; }`,
    ).join("\n");
    const file = join(dir, `m${s}.js`);
    writeFileSync(file, text);
    const mappings = ["AAAA", ...Array.from({ length: lines - 1 }, () => VLQ)].join(";");
    const sha1 = createHash("sha1").update(text).digest("hex");
    sources.set(file, {
      path: `src/m${s}.js`,
      code: text,
      map: { mappings, sourcesContent: [text] },
      sha1,
    });
    let offset = 0;
    const functions = text.split("\n").map((line, l) => {
      const at = offset;
      offset += line.length + 1;
      const branch = line.indexOf("return a");
      return {
        functionName: `f${l}`,
        isBlockCoverage: true,
        ranges: [
          { startOffset: at, endOffset: at + line.length, count: l % 3 },
          { startOffset: at + branch, endOffset: at + branch + 9, count: 0 },
        ],
      };
    });
    scripts.push({ url: `file://${file}`, functions, startOffset: 0 });
  }
  const text = JSON.stringify({ result: scripts });
  const original = join(dir, "payload.json");
  writeFileSync(original, text);
  let links = 0;
  return {
    dir,
    sources,
    scripts,
    bytes: Buffer.byteLength(text),
    file(path = "test/a.test.ts") {
      const payload = join(dir, `payload-${links++}.json`);
      linkSync(original, payload);
      return { testFile: { project: "", path }, payload, sources };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The mapping worker from the TypeScript sources, as Node strips their types. */
export const TS_WORKER = {
  script: fileURLToPath(new URL("../../../src/core/code/coverage/map-worker.ts", import.meta.url)),
  execArgv: [
    "--disable-warning=ExperimentalWarning",
    "--import",
    fileURLToPath(new URL("../../store/child/register-ts.mjs", import.meta.url)),
  ],
} as const;
