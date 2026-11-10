import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapHere } from "../../../src/core/code/coverage/mapper.js";
import { COVERAGE_PROVIDER_VERSION, decodeRecord } from "../../../src/core/code/coverage/record.js";
import { KEPT_NOTE } from "../../../src/runners/vitest/coverage.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 020 D12 item 2 (row 020-10a): with `coverage.children`, Squeal's
 * provider points each test file's worker at a directory of its own, named
 * by the file's payload, so the processes its tests start write their
 * coverage there; a variable already set is left alone, with a note.
 */

const temps: string[] = [];
// Under a daemon that measures this file's children, its fixture's workers would inherit the variable.
beforeEach(() => {
  vi.stubEnv("NODE_V8_COVERAGE", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lines = (...text: string[]) => `${text.join("\n")}\n`;

/** Two test files, each running one plain child that imports a source no test file imports. */
function children(pool: "forks" | "threads", env: Readonly<Record<string, string>> = {}) {
  const test = (name: string, arg: number, out: string) =>
    lines(
      'import { execFileSync } from "node:child_process";',
      'import { fileURLToPath } from "node:url";',
      'import { expect, test } from "vitest";',
      `test("${name}", () => {`,
      '  const bin = fileURLToPath(new URL("../bin/child.mjs", import.meta.url));',
      `  expect(execFileSync(process.execPath, [bin, "${arg}"], { encoding: "utf8" })).toBe("${out}");`,
      "});",
    );
  return {
    "vitest.config.ts": lines(
      'import { defineConfig } from "vitest/config";',
      `export default defineConfig({ test: { include: ["test/**/*.test.ts"], pool: "${pool}", env: ${JSON.stringify(env)} } });`,
    ),
    "src/child-only.mjs": lines(
      "export function childOnly(x) {",
      '  return x > 1 ? "big" : "small";',
      "}",
    ),
    "bin/child.mjs": lines(
      'import { childOnly } from "../src/child-only.mjs";',
      'process.stdout.write(childOnly(Number(process.argv[2])) + ":" + (process.env.NODE_V8_COVERAGE ? "set" : "unset"));',
    ),
    "test/a.test.ts": test("a big child", 3, "big:set"),
    "test/b.test.ts": test("a small child", 0, "small:set"),
  };
}

const FILES = ["test/a.test.ts", "test/b.test.ts"];

describe("vitest adapter: children's coverage (020 D12)", SLOW, () => {
  it.each(["forks", "threads"] as const)(
    "gives each test file of a %s pool a children directory its payload names, mapped into its record",
    async (pool) => {
      const opened = covering({ children: () => true });
      const fx = await openFixture("own-provider", children(pool), opened.create);
      const report = await fx.adapter.run(
        FILES.map((f) => ref(f)),
        fx.runOptions(),
      );

      expect(report.failure).toBeNull();
      expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual([
        ["test/a.test.ts", "pass"],
        ["test/b.test.ts", "pass"],
      ]);
      const files = [...(opened.runs[0]?.files ?? [])].sort((a, b) =>
        a.testFile.path.localeCompare(b.testFile.path),
      );
      expect(files.map((f) => f.testFile.path)).toEqual(FILES);
      const dirs = files.map((f) => f.children?.dir ?? "");
      expect(new Set(dirs).size).toBe(2);
      for (const file of files) {
        const id = basename(file.payload, ".json").replace(/^coverage-/, "");
        expect(file.children).toEqual({
          root: fx.root,
          dir: join(dirname(file.payload), `children-${id}`),
        });
        expect(
          readdirSync(file.children?.dir ?? "").some((n) => /^coverage-.*\.json$/.test(n)),
        ).toBe(true);
      }

      const [a] = files;
      if (a === undefined) throw new Error("no payload");
      const record = decodeRecord(mapHere(a, "sha1", new Map(), () => false));
      expect(record.sources.map((s) => s.path)).toEqual([
        "bin/child.mjs",
        "src/child-only.mjs",
        "test/a.test.ts",
      ]);
      expect(existsSync(a.children?.dir ?? "")).toBe(false);
      expect(opened.notes.filter((n) => n.includes("D12"))).toEqual([]);
    },
  );

  it("leaves a project's own NODE_V8_COVERAGE to its tests, and says so once", async () => {
    const own = mkdtempSync(join(tmpdir(), "sq-own-v8-"));
    temps.push(own);
    const opened = covering({ children: () => true });
    const fx = await openFixture(
      "own-provider",
      children("forks", { NODE_V8_COVERAGE: own }),
      opened.create,
    );
    const report = await fx.adapter.run(
      FILES.map((f) => ref(f)),
      fx.runOptions(),
    );

    expect(report.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
    // The children wrote where the project pointed them; Squeal's directories stay unmade.
    expect(readdirSync(own).length).toBeGreaterThan(0);
    for (const file of opened.runs[0]?.files ?? [])
      expect(existsSync(file.children?.dir ?? "")).toBe(false);
    expect(opened.notes.filter((n) => n.includes("D12"))).toEqual([KEPT_NOTE]);
  });

  it("names the children in the key's marker only while they are measured, and a flip re-keys", async () => {
    const on = { value: true };
    const fx = await openFixture("own-provider", {}, covering({ children: () => on.value }).create);
    const config = async () => {
      const [environment] = await fx.adapter.environment();
      return JSON.parse(environment?.resolvedConfig ?? "null") as { coverage: unknown };
    };
    const measured = await config();
    on.value = false;
    // The daemon reloads its policy at the config's change, then invalidates with it.
    const changed = [{ path: "squeal.config.json", kind: "change" as const }];
    expect(await fx.adapter.invalidate(changed)).toEqual({ recreatedProjects: [""] });
    const unmeasured = await config();

    expect(measured.coverage).toEqual({
      provider: "squeal",
      version: COVERAGE_PROVIDER_VERSION,
      children: true,
    });
    expect(unmeasured.coverage).toEqual({ provider: "squeal", version: COVERAGE_PROVIDER_VERSION });
    expect({ ...measured, coverage: null }).toEqual({ ...unmeasured, coverage: null });
  });
});
