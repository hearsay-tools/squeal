import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRecord,
  COVERAGE_PROVIDER_VERSION,
  type CoverageWriterOptions,
  type CoveredFile,
  createCoverageWriter,
  decodeRecord,
} from "../../../src/core/code/coverage/index.js";
import { encodeRecord } from "../../../src/core/code/coverage/record.js";
import { commonDir, ON, open } from "../helpers.js";
import { type PayloadSet, payloads, TS_WORKER } from "./payloads.js";

/*
 * Row 015-42: the records' writer maps each payload in a worker thread,
 * and the records stay byte-identical to the main thread's mapping
 * (015-11). A worker that fails is told once; the rest is mapped on the
 * main thread.
 */

const sets: PayloadSet[] = [];
afterEach(() => {
  for (const set of sets.splice(0)) set.cleanup();
});

/** Stores `files` through a writer and returns each test file's stored record. */
async function stored(files: readonly CoveredFile[][], over: Partial<CoverageWriterOptions>) {
  const dir = commonDir();
  const logs: string[] = [];
  const writer = createCoverageWriter({
    commonDir: dir,
    format: "sha1",
    policy: () => ON,
    resultKey: (_run, testFile) => `key-${testFile.path}`,
    log: (text) => logs.push(text),
    ...over,
  });
  for (const [i, run] of files.entries()) writer.collected({ runId: `run-${i}`, files: run });
  await writer.idle();
  await writer.close();
  const store = open(dir);
  const records = files.flat().map((file) => {
    const bytes = store.coverage.get({
      resultKey: `key-${file.testFile.path}`,
      providerVersion: COVERAGE_PROVIDER_VERSION,
    });
    return bytes === null ? null : Buffer.from(bytes).toString("base64");
  });
  return { records, logs };
}

describe("the records' writer's worker thread (row 015-42)", () => {
  it("stores the bytes the main thread's mapping makes, with sources it keeps and forgets", async () => {
    const set = payloads(12, 40);
    sets.push(set);
    const [provider, outside, stale, edited] = [...set.sources.keys()];
    const sources = new Map(set.sources);
    // The provider and a script outside the run's sources have no entry. A file changed
    // after the run is read from its map's sources, and one whose map differs too is unread.
    if (outside !== undefined) sources.delete(outside);
    for (const path of [stale, edited]) if (path !== undefined) writeFileSync(path, "changed\n");
    const was = stale === undefined ? undefined : sources.get(stale);
    if (stale !== undefined && was !== undefined) {
      sources.set(stale, { ...was, map: { ...was.map, sourcesContent: ["other"] } });
    }
    const skip = (path: string) => path === provider;
    // Three runs' sources, the files back and forth: the worker keeps two, so it asks again.
    const own = [0, 1, 2].map(() => new Map(sources));
    const order = [0, 1, 2, 0, 1, 2, 0];
    const run = (tag: string) =>
      order.map((r, f) => ({ ...set.file(`test/${tag}${f}.test.ts`), sources: own[r] ?? sources }));
    const files = run("f");
    const expected = files.map((file) =>
      Buffer.from(encodeRecord(buildRecord(file, set.scripts, "sha1", new Map(), skip))).toString(
        "base64",
      ),
    );

    const viaWorker = await stored([files], { worker: TS_WORKER, skip });
    const here = await stored(
      [files.map((f) => ({ ...f, ...set.file(f.testFile.path), sources: f.sources }))],
      {
        worker: null,
        skip,
      },
    );

    expect(viaWorker.logs).toEqual([]);
    expect(here.logs).toEqual([]);
    expect(viaWorker.records).toEqual(expected);
    expect(here.records).toEqual(expected);
    const record = decodeRecord(Buffer.from(expected[0] ?? "", "base64"));
    expect(record.unread).toEqual(["src/m2.js"]);
    expect(record.sources.map((s) => s.path)).toEqual(
      ["src/m3.js", ...Array.from({ length: 8 }, (_, s) => `src/m${s + 4}.js`)].sort(),
    );
  });

  it("tells a worker that fails once, and maps its payloads on the main thread", async () => {
    const set = payloads(3, 10);
    sets.push(set);
    const broken = join(set.dir, "broken-worker.mjs");
    writeFileSync(broken, 'throw new Error("no mapping here");\n');
    const files = [set.file("test/a.test.ts"), set.file("test/b.test.ts")];
    const expected = files.map((file) =>
      Buffer.from(encodeRecord(buildRecord(file, set.scripts, "sha1", new Map()))).toString(
        "base64",
      ),
    );

    const { records, logs } = await stored([files], { worker: { script: broken } });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(
      /^coverage: the mapping worker failed \(.*no mapping here.*\); mapping on the main thread$/,
    );
    expect(records).toEqual(expected);
  });

  it("loses no record when the worker exits on the sources it asked for (review 0.1.305 B2)", async () => {
    const set = payloads(3, 10);
    sets.push(set);
    // The worker reads the first payload and asks for its sources, then exits on the answer.
    const exits = join(set.dir, "exits-worker.mjs");
    writeFileSync(
      exits,
      [
        'import { parentPort } from "node:worker_threads";',
        'parentPort.on("message", (message) => { if (message.type === "sources") process.exit(3); });',
        `await import(${JSON.stringify(pathToFileURL(TS_WORKER.script).href)});`,
        "",
      ].join("\n"),
    );
    const files = [set.file("test/a.test.ts"), set.file("test/b.test.ts")];
    const expected = files.map((file) =>
      Buffer.from(encodeRecord(buildRecord(file, set.scripts, "sha1", new Map()))).toString(
        "base64",
      ),
    );

    const { records, logs } = await stored([files], { worker: { ...TS_WORKER, script: exits } });

    expect(records.map((r) => r !== null)).toEqual([true, true]);
    expect(records).toEqual(expected);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^coverage: the mapping worker failed \(.*code 3.*\); mapping/);
    expect(files.map((file) => existsSync(file.payload))).toEqual([false, false]);
  });
});
