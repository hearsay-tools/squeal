import { describe, expect, it } from "vitest";
import { ALL_TEST_FILES, openFixture, ref, SLOW } from "./helpers.js";

const VITE_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];

describe("vitest adapter: closure, enumerate, testFiles, environment", SLOW, () => {
  it("lists every test file from the project's include globs", async () => {
    const fx = await openFixture();
    expect(await fx.adapter.testFiles()).toEqual(ALL_TEST_FILES.map((p) => ref(p)));
  });

  it("builds a closure from the transform graph plus the snapshot path", async () => {
    const fx = await openFixture();
    // Spec 001 D3: "its snapshot file path whether or not the file exists" (review B1).
    expect(await fx.adapter.closure(ref("test/math.test.ts"))).toEqual({
      testFile: ref("test/math.test.ts"),
      paths: [
        "src/deep.ts",
        "src/math.ts",
        "test/__snapshots__/math.test.ts.snap",
        "test/math.test.ts",
      ],
      // Task 001-105: `vitest` resolves from the repository, outside this worktree's install.
      packages: { imports: [], builtins: [] },
    });
    expect((await fx.adapter.closure(ref("test/strings.test.ts"))).paths).toEqual([
      "src/strings.ts",
      "test/__snapshots__/strings.test.ts.snap",
      "test/strings.test.ts",
    ]);
    // Setup files belong to the environment hash, not to each closure.
    expect((await fx.adapter.closure(ref("test/greeting.test.ts"))).paths).toEqual([
      "test/__snapshots__/greeting.test.ts.snap",
      "test/greeting.test.ts",
    ]);
  });

  it("adds every resolution candidate of an unresolved import to the closure", async () => {
    const fx = await openFixture();
    fx.write(
      "test/missing.test.ts",
      [
        'import { it } from "vitest";',
        'import { client } from "../src/client";',
        'import { util } from "./helpers/util.js";',
        'it("uses them", () => { client(util); });',
        "",
      ].join("\n"),
    );
    await fx.adapter.invalidate([{ path: "test/missing.test.ts", kind: "add" }]);

    // Spec 001 D3: "for every unresolved import the target path and its
    // resolution candidates (each configured extension and `index` file)".
    // Vite's default `resolve.extensions`; a `.js` specifier also resolves to
    // `.ts` and `.tsx`, as Vite does for TypeScript importers.
    const candidates = (target: string) => [
      target,
      ...VITE_EXTENSIONS.map((ext) => `${target}${ext}`),
      ...VITE_EXTENSIONS.map((ext) => `${target}/index${ext}`),
    ];
    const expected = [
      ...candidates("src/client"),
      ...candidates("test/helpers/util.js"),
      "test/helpers/util.ts",
      "test/helpers/util.tsx",
      "test/__snapshots__/missing.test.ts.snap",
      "test/missing.test.ts",
    ].sort();
    expect((await fx.adapter.closure(ref("test/missing.test.ts"))).paths).toEqual(expected);
  });

  it("enumerates tests statically and flags templated test.each entries", async () => {
    const fx = await openFixture();
    const checks = await fx.adapter.enumerate(ref("test/each.test.ts"));
    expect(checks).toEqual([
      {
        check: {
          kind: "test",
          project: "",
          testPath: "test/each.test.ts",
          fullName: "static name",
        },
        templated: false,
        location: { path: "test/each.test.ts", line: 4, column: 1 },
      },
      {
        check: {
          kind: "test",
          project: "",
          testPath: "test/each.test.ts",
          fullName: "add(%i, %i) = %i",
        },
        templated: true,
        location: { path: "test/each.test.ts", line: 11, column: 3 },
      },
    ]);
    const math = await fx.adapter.enumerate(ref("test/math.test.ts"));
    expect(math.map((c) => c.check.fullName)).toEqual(["math > adds", "math > adds base"]);
  });

  it("reports environment inputs with canonical config and file paths", async () => {
    const fx = await openFixture();
    const envs = await fx.adapter.environment();
    expect(envs).toHaveLength(1);
    const env = envs[0];
    if (!env) throw new Error("no environment");
    expect(env.project).toBe("");
    expect(env.runnerName).toBe("vitest");
    expect(env.runnerVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(env.adapterVersion).toBe(fx.adapter.adapterVersion);
    expect(env.resolvedConfig).not.toContain(fx.root);
    expect(JSON.parse(env.resolvedConfig).setupFiles).toEqual(["test/setup.ts"]);

    // Paths only: the core hashes them through its stat cache (review S3).
    expect(env.files).toEqual([
      "src/global-dep.ts",
      "src/setup-dep.ts",
      "test/global-setup.ts",
      "test/setup.ts",
      "vitest.config.ts",
      "vitest.shared.ts",
    ]);
  });

  it("produces identical environment inputs for a copy at another path", async () => {
    const [a, b] = await Promise.all([openFixture(), openFixture()]);
    if (!a || !b) throw new Error("no fixture");
    expect(a.root).not.toBe(b.root);
    expect(await a.adapter.environment()).toEqual(await b.adapter.environment());
    expect(await a.adapter.closure(ref("test/math.test.ts"))).toEqual(
      await b.adapter.closure(ref("test/math.test.ts")),
    );
  });

  it("rejects a test file of an unknown project with the project name", async () => {
    const fx = await openFixture();
    await expect(fx.adapter.enumerate(ref("test/math.test.ts", "missing"))).rejects.toThrow(
      /project "missing"/,
    );
    await expect(fx.adapter.closure(ref("test/math.test.ts", "missing"))).rejects.toThrow(
      /project "missing"/,
    );
  });
});
