// Row 025-24: the bench project pins Vite beside Vitest, and each run records and prints the
// versions it installed (research/bench-provider.md: Vite 8.4.0 changed the benchmark unpinned).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

type Deps = Record<string, string | null>;
interface Lib {
  BENCH_DEPS: Record<string, string>;
  installedVersions(dir: string): Deps;
}
interface Summarize {
  depsText(meta: { deps?: Record<string, Deps> }): string;
  summarize(dir: string): { scorecard: string };
}

const BENCH = join(import.meta.dirname, "../../bench");
// A variable path: TypeScript types these plain-JavaScript modules as `any`, cast to the shapes above.
const load = (name: string) => import(join(BENCH, name));
const lib: Lib = await load("lib.mjs");
const sum: Summarize = await load("summarize.mjs");

const tmp = mkdtempSync(join(tmpdir(), "bench-deps-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const PINNED = { vitest: "5.0.3", vite: "8.4.0", "@vitest/coverage-v8": "5.0.3" };

describe("the bench project's pinned dependencies", () => {
  it("pins vite exactly beside vitest and @vitest/coverage-v8", () => {
    const dir = join(tmp, "gen");
    execFileSync(process.execPath, [join(BENCH, "gen-project.mjs"), dir, "2"]);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.devDependencies).toEqual(PINNED);
    expect(lib.BENCH_DEPS).toEqual(PINNED);
  });

  it("reads the installed versions from node_modules, null for a missing one", () => {
    const dir = join(tmp, "installed");
    for (const [name, version] of Object.entries({ vitest: "5.0.3", vite: "8.4.0" })) {
      mkdirSync(join(dir, "node_modules", name), { recursive: true });
      writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ version }));
    }
    expect(lib.installedVersions(dir)).toEqual({
      vitest: "5.0.3",
      vite: "8.4.0",
      "@vitest/coverage-v8": null,
    });
  });
});

describe("the scorecard header names the installed versions", () => {
  it("prints one set, each distinct set, and nothing for an older run", () => {
    expect(sum.depsText({ deps: { p500: PINNED, p100: PINNED } })).toBe(
      " · Vitest 5.0.3 · Vite 8.4.0 · coverage-v8 5.0.3",
    );
    expect(sum.depsText({ deps: { p500: PINNED, p100: { ...PINNED, vite: "8.3.8" } } })).toBe(
      " · Vitest 5.0.3 · Vite 8.4.0 · coverage-v8 5.0.3 / Vitest 5.0.3 · Vite 8.3.8 · coverage-v8 5.0.3",
    );
    expect(sum.depsText({ deps: { p500: { ...PINNED, vite: null } } })).toContain("Vite ?");
    expect(sum.depsText({})).toBe("");
  });

  it("puts them after Node in a stored run's header line", () => {
    const RUN = "2026-11-24-0.1.615-vs-0.1.616-default-AMD-Ryzen-7-9700X-8-Core-Processor";
    const dir = join(tmp, RUN);
    cpSync(join(BENCH, "results", RUN), dir, { recursive: true });
    const metaFile = join(dir, "meta.json");
    const meta = JSON.parse(readFileSync(metaFile, "utf8"));
    const before = sum.summarize(dir).scorecard;
    expect(before).not.toContain("Vite ");
    writeFileSync(metaFile, JSON.stringify({ ...meta, deps: { p500: PINNED } }));
    const header = sum.summarize(dir).scorecard.split("\n")[2];
    expect(header).toContain(
      `Node ${meta.node} · Vitest 5.0.3 · Vite 8.4.0 · coverage-v8 5.0.3 · `,
    );
  });
});
