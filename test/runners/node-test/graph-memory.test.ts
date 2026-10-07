import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

/**
 * 003-27: keeping enhanced-resolve's filesystem and resolver instances after
 * graph work retains about 12 MiB at 1,000 modules. An isolated process with
 * explicit GC measures retained heap, independent of Vitest's own heap.
 * Eight MiB leaves room for the module table, index and compact resolution
 * summaries, while catching the old unbounded filesystem caches.
 */
it("releases build caches after cold builds, re-resolves, edits and listing changes", {
  timeout: 180_000,
}, () => {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-graph-memory-"));
  const root = join(scratch, "big");
  const generator = resolve(import.meta.dirname, "../../fixtures/node-test/gen-big.mjs");
  const graphModule = pathToFileURL(
    resolve(import.meta.dirname, "../../../src/runners/node-test/graph/index.ts"),
  ).href;
  const parserModule = pathToFileURL(
    resolve(import.meta.dirname, "../../../src/runners/node-test/graph/parse.ts"),
  ).href;
  try {
    execFileSync(process.execPath, [generator, root]);
    const output = execFileSync(
      process.execPath,
      [
        "--expose-gc",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import { appendFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { createNodeTestGraph } from ${JSON.stringify(graphModule)};
      import { parserReady } from ${JSON.stringify(parserModule)};
      await parserReady;
      const root = ${JSON.stringify(root)};
      const files = Array.from({ length: 200 }, (_, t) =>
        "packages/core/test/unit/t" + String(t).padStart(3, "0") + ".test.ts");
      const heap = () => {
        for (let i = 0; i < 3; i++) global.gc();
        return process.memoryUsage().heapUsed;
      };
      const before = heap();
      const graph = await createNodeTestGraph({ root,
        cwd: join(root, "packages/core"),
        argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
        testFiles: files });
      graph.affected([]);
      const retained = { cold: heap() - before };
      const added = "packages/core/src/added.ts";
      writeFileSync(join(root, added), "export const added = 1;\\n");
      graph.invalidate([{ path: added, kind: "add" }]);
      graph.affected([added]);
      retained.reresolve = heap() - before;
      const edited = "packages/core/src/m350.ts";
      appendFileSync(join(root, edited), '\\nimport "./added.js";\\n');
      graph.invalidate([{ path: edited, kind: "change" }]);
      graph.affected([edited]);
      retained.edit = heap() - before;
      const listed = "packages/core/test/unit/extra.test.ts";
      writeFileSync(join(root, listed), 'import "../../src/m350.js";\\n');
      graph.setTestFiles([...files, listed]);
      const closure = graph.closure(listed).paths;
      retained.listing = heap() - before;
      console.log(JSON.stringify({ retained, closure }));
    `,
      ],
      { encoding: "utf8", timeout: 150_000 },
    );
    const measured: { retained: Record<string, number>; closure: string[] } = JSON.parse(output);
    console.log(
      "node-test graph retained heap, 1,000 modules (MiB):",
      Object.fromEntries(
        Object.entries(measured.retained).map(([stage, bytes]) => [stage, bytes / 2 ** 20]),
      ),
    );
    expect(measured.closure).toContain("packages/core/src/added.ts");
    for (const bytes of Object.values(measured.retained)) expect(bytes).toBeLessThan(8 * 2 ** 20);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
