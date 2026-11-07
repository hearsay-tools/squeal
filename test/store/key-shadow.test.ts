import { describe, expect, it } from "vitest";
import { openFixture, ref, SLOW } from "../runners/vitest/helpers.js";
import { keyed } from "./test-key.js";

/*
 * R2 Step 0 (review 0.1.415-r2 B2): an import edge is only as valid as
 * the result key it is written with, so the key must move when the
 * importer's target does. Here `./leaf.js` resolves to `src/leaf.ts`
 * until `src/leaf.js` appears beside it, with the importer's bytes
 * unchanged: the daemon re-walks the test file, and its key moves.
 */

const FILES = {
  "src/gateway.ts": 'export { value } from "./leaf.js";\n',
  "src/leaf.ts": "export const value = 1;\n",
  "test/gate.test.ts": [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/gateway.js";',
    'it("g", () => expect(value).toBeGreaterThan(0));',
    "",
  ].join("\n"),
};

describe("a test file's key when a file shadows its import's target (R2 Step 0)", SLOW, () => {
  it("moves once the daemon re-walks the test file after the add", async () => {
    const fx = await openFixture("basic", FILES);
    const test = ref("test/gate.test.ts");
    const before = await fx.adapter.closure(test);
    const environments = await fx.adapter.environment();
    const keyBefore = (await keyed(fx.root, environments, [before])).index.key(test);
    expect(before.paths).toContain("src/leaf.ts");

    fx.write("src/leaf.js", "export const value = 2;\n");
    await fx.adapter.invalidate([{ path: "src/leaf.js", kind: "add" }]);
    // The daemon re-resolves it: the runner's affected walk names it, as does its closure's folder.
    expect((await fx.adapter.affected(["src/leaf.js"])).transitive).toContainEqual(test);
    const after = await fx.adapter.closure(test);
    const keyAfter = (await keyed(fx.root, environments, [after])).index.key(test);

    expect(after.paths).toContain("src/leaf.js");
    expect(after.paths).not.toContain("src/leaf.ts");
    expect(after.imports?.find((f) => f.path === "src/gateway.ts")?.static).toEqual([
      "src/leaf.js",
    ]);
    expect(keyAfter).not.toBe(keyBefore);
    // The first closure names no shadow candidate: keyed now, before a re-walk, it keys as before.
    expect((await keyed(fx.root, environments, [before])).index.key(test)).toBe(keyBefore);
  });

  /*
   * KNOWN OPEN DEFECT (R2 Step 0 (B), reported 2026-11-07 to the coordinator,
   * the human and spec 011's coordinator; not fixed in row 015-109): a file
   * that shadows a setup import's target is no environment file, so the
   * daemon reads no environment again and every key of the project stays,
   * while the setup file now loads the shadow. This pins today's behaviour;
   * the fix changes it, and this case with it.
   */
  it("stays for a setup import's shadow until the environment is read again (known defect)", async () => {
    const fx = await openFixture("basic", {
      "vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        'export default defineConfig({ test: { include: ["test/plain.test.ts"], setupFiles: ["test/setup.ts"] } });',
        "",
      ].join("\n"),
      "test/setup.ts":
        'import { value } from "../src/sleaf.js";\n(globalThis as { v?: number }).v = value;\n',
      "src/sleaf.ts": "export const value = 1;\n",
      "test/plain.test.ts":
        'import { expect, it } from "vitest";\nit("p", () => expect(1).toBe(1));\n',
    });
    const test = ref("test/plain.test.ts");
    const environments = await fx.adapter.environment();
    const closure = await fx.adapter.closure(test);
    const keyBefore = (await keyed(fx.root, environments, [closure])).index.key(test);

    fx.write("src/sleaf.js", "export const value = 2;\n");
    // No environment file, and no project recreated: the daemon keeps the environment it read.
    expect(environments[0]?.files).not.toContain("src/sleaf.js");
    expect(await fx.adapter.invalidate([{ path: "src/sleaf.js", kind: "add" }])).toEqual({
      recreatedProjects: [],
    });
    expect((await keyed(fx.root, environments, [closure])).index.key(test)).toBe(keyBefore);
    // Only a new environment read sees the shadow.
    const reread = await fx.adapter.environment();
    expect(reread[0]?.files).toContain("src/sleaf.js");
    expect((await keyed(fx.root, reread, [closure])).index.key(test)).not.toBe(keyBefore);
  });
});
