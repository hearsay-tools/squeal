import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { nodeTestRuntime } from "../../../src/runners/node-test/runtime.js";

const SOURCE = resolve(import.meta.dirname, "../../../src/runners/node-test");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-runtime-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("nodeTestRuntime", () => {
  it("finds runtime/ beside the TypeScript sources", () => {
    expect(nodeTestRuntime()).toEqual({
      reporter: join(SOURCE, "runtime/reporter.mjs"),
      recorder: join(SOURCE, "runtime/recorder.cjs"),
    });
  });

  it("finds dist/node-test/ from a CLI bundled at dist/cli/", () => {
    const dist = join(scratch, "plugin/dist");
    mkdirSync(join(dist, "cli"), { recursive: true });
    mkdirSync(join(dist, "node-test"), { recursive: true });
    for (const name of ["reporter.mjs", "recorder.cjs"])
      writeFileSync(join(dist, "node-test", name), "");
    expect(nodeTestRuntime(pathToFileURL(join(dist, "cli/squeal.mjs")))).toEqual({
      reporter: join(dist, "node-test/reporter.mjs"),
      recorder: join(dist, "node-test/recorder.cjs"),
    });
  });

  it("names the directories it tried when the files are missing", () => {
    const module = pathToFileURL(join(scratch, "elsewhere/cli/squeal.mjs"));
    expect(() => nodeTestRuntime(module)).toThrow(/runtime files not found .*elsewhere\/node-test/);
  });

  it.each(["reporter.mjs", "recorder.cjs"])(
    "keeps %s dependency-free: it runs inside the project's Node",
    (name) => {
      const source = readFileSync(join(SOURCE, "runtime", name), "utf8");
      const imports = [
        ...source.matchAll(/\bfrom\s+"([^"]+)"|\b(?:import|require)\(\s*"([^"]+)"/g),
      ].map((m) => m[1] ?? m[2]);
      for (const specifier of imports) expect(specifier).toMatch(/^node:/);
    },
  );
});
