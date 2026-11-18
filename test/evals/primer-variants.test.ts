import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPatch, patchPlugins } from "../../evals/lib/index.mjs";

// Row 005-127 (wave 30): the two primer arms flip 005-126's form switch in the built bundles.
// esbuild keeps `export const PRIMER_FORM: PrimerForm = "full";` as a top-level `var`, once in
// each of the 25 bundles that inline the primer (005-126's notes; today's `PRIMER_CAP_CHARS`
// shows the same form and count).
const REPO = join(import.meta.dirname, "../..");
const variant = (name: string) =>
  JSON.parse(readFileSync(join(REPO, "evals/variants", `${name}.json`), "utf8"));
const LINE = 'var PRIMER_FORM = "full";';
/** A bundle as esbuild writes one around the switch. */
const BUNDLE = `// src/harness/shared/primer.ts\nvar PRIMER_CAP_CHARS = 1500;\n${LINE}\nfunction primer(input) {\n  return PRIMER_FORM === "full" ? full(input) : short(input, PRIMER_FORM);\n}\n`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
/** `bundles` plugin bundles carrying the switch, spread over two plugins. */
function plugins(bundles: number) {
  const d = mkdtempSync(join(tmpdir(), "squeal-primer-variant-"));
  dirs.push(d);
  for (let i = 0; i < bundles; i++) {
    const dir = join(d, i % 2 ? "codex-runtime" : "claude-code", "dist/hooks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `h${i}.mjs`), BUNDLE);
  }
  return d;
}

describe.each([
  ["primer-minimal", "minimal"],
  ["primer-minimal-rules", "minimal-rules"],
])("variant %s", (name, form) => {
  it(`turns the switch's line into "${form}" and nothing else`, () => {
    const [patch, ...rest] = variant(name).patch;
    expect(rest).toEqual([]);
    const { text, count } = applyPatch(BUNDLE, patch);
    expect(count).toBe(1);
    expect(text).toBe(BUNDLE.replace(LINE, `var PRIMER_FORM = "${form}";`));
    expect(patch).toMatchObject({ files: "plugins/*/dist/**/*.mjs", min: 25 });
    expect(variant(name).plugin).toBe(true);
  });

  it("patches all 25 bundles, and fails loudly on a build with fewer", () => {
    const d = plugins(25);
    expect(patchPlugins(d, variant(name))).toEqual([{ find: LINE, count: 25 }]);
    const text = readFileSync(join(d, "codex-runtime/dist/hooks/h1.mjs"), "utf8");
    expect(text).toContain(`var PRIMER_FORM = "${form}";`);
    expect(() => patchPlugins(plugins(24), variant(name))).toThrow(/matched 24 times/);
  });
});
