import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import type { Gap, Pack } from "../driver.js";
import { isTest, type Module, type Written } from "../scenarios/index.js";

/*
 * Vitest's pack (spec 016 D1): TypeScript modules under `src/`, tests
 * under `test/`, a dependency under `node_modules/`. A startup hook is a
 * setup file. Vitest honours an edit's cancel, so its variants cut a held
 * run for `step-down` too, the cause whose grace keeps a whole file (011
 * `reviews/0.1.287.md` B1).
 */

const REPO = resolve(import.meta.dirname, "../../..");
const STARTED = (holds: string) => `new URL("../${holds}.started", import.meta.url)`;
/** What a startup hook shares with every test. */
const SHARED = "(globalThis as { kitValue?: number }).kitValue";
const HOLD = "await new Promise((done) => setTimeout(done, 600_000))";

/** 011 C12, observed runtime inputs, "Not seen, and left to `inputs`". */
const C12: Gap = {
  spec: "011 C12: not seen, and left to `inputs`: Vitest's own process (a computed `import()` Vite loads)",
  fails: ["step 2 edit"],
};

/**
 * K10: a computed `import()` is C12's gap, as in K4. A child process's
 * loads are kept as observed reads (C12), so b and the restart hold them,
 * but `affected()` reads Vite's module graph alone, so they are never
 * direct; no spec line says so.
 */
const K10: Gap = {
  spec: "011 C12: not seen, and left to `inputs`: Vitest's own process (a computed `import()` Vite loads); 016 goal 6, no line documents it: a child process's loads are observed reads, never `direct` (candidate row)",
  fails: [
    "step 4 holds",
    "step 6 edit",
    "step 7 direct",
    "step 10 holds",
    "step 12 edit",
    "step 13 direct",
  ],
};

function test(module: Extract<Written, { kind: "test" }>, of: (name: string) => Module): string {
  const from = of(module.from);
  const check = `it(${JSON.stringify(module.check)}, () => expect(`;
  if (from.kind === "hook") return `${check}${SHARED}).toBe(${module.expect}));`;
  const specifier = from.kind === "dependency" ? module.from : `../src/${module.from}`;
  return [
    `import { value } from ${JSON.stringify(specifier)};`,
    `${check}value).toBe(${module.expect}));`,
  ].join("\n");
}

/** A held file whose holding check is declared as `holds` gives it. */
function held(module: Extract<Written, { kind: "held" }>, holds: string, after = ""): string {
  return [
    `import { writeFileSync } from "node:fs";`,
    `import { afterEach, it } from "vitest";`,
    `it(${JSON.stringify(module.check)}, () => {});`,
    `${holds}(${JSON.stringify(module.holds)}, { timeout: 600_000 }, async () => {`,
    `  writeFileSync(${STARTED(module.holds)}, "");`,
    `  ${HOLD};`,
    `});`,
    after,
    "",
  ].join("\n");
}

function text(module: Written, of: (name: string) => Module): string {
  switch (module.kind) {
    case "value":
      return `export const value = ${module.value};\n`;
    case "reexport":
      return `export { value } from "./${module.from}";\n`;
    case "test":
      return [`import { expect, it } from "vitest";`, test(module, of), ""].join("\n");
    case "computed":
      return [
        `import { expect, it } from "vitest";`,
        `it(${JSON.stringify(module.check)}, async () => {`,
        `  const { value } = await import(/* @vite-ignore */ ["..", "src", "${module.from}.ts"].join("/"));`,
        `  expect(value).toBe(${module.expect});`,
        `});`,
        "",
      ].join("\n");
    case "hook":
      return [
        `const { value } = await import(/* @vite-ignore */ ["./${module.from}", "ts"].join("."));`,
        `${SHARED} = value;`,
        "",
      ].join("\n");
    case "dependency":
      return `exports.value = ${module.value};\n`;
    case "held":
      return held(module, "it");
    case "child":
      return `import { value } from "./${module.from}.ts";\nconsole.log(value);\n`;
    case "spawns":
      return [
        `import { execFileSync } from "node:child_process";`,
        `import { fileURLToPath } from "node:url";`,
        `import { expect, it } from "vitest";`,
        `it(${JSON.stringify(module.check)}, () => {`,
        `  const child = fileURLToPath(new URL("../src/${module.child}.mjs", import.meta.url));`,
        `  const printed = execFileSync(process.execPath, [child], { encoding: "utf8" });`,
        `  expect(Number(printed)).toBe(${module.expect});`,
        `});`,
        "",
      ].join("\n");
    case "broken":
      return "export const value = ;\n";
  }
}

const config = (setupFiles: readonly string[]) =>
  `export default { test: { include: ["test/**/*.test.ts"], setupFiles: ${JSON.stringify(setupFiles)} } };\n`;

const base: Pack = {
  name: "vitest",
  path: (name, module) => {
    if (isTest(module)) return `test/${name}.test.ts`;
    if (module.kind === "child") return `src/${name}.mjs`;
    return module.kind === "dependency" ? `node_modules/${name}/index.js` : `src/${name}.ts`;
  },
  text,
  fullName: (check) => check,
  project: {
    "package.json": '{ "name": "kit", "private": true, "type": "module" }\n',
    "vitest.config.ts": config([]),
  },
  open: (root, _scratch, { hooks }) => {
    // `vitest/node` and `vitest` resolve from the fixture root: the repository's own Vitest,
    // linked alone so that a scenario's installed package lands in the fixture's `node_modules`.
    // A restart opens over the same root, which has the link.
    const link = join(root, "node_modules", "vitest");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    if (!existsSync(link)) symlinkSync(join(REPO, "node_modules", "vitest"), link);
    if (hooks.length > 0) writeFileSync(join(root, "vitest.config.ts"), config(hooks));
    return createVitestAdapter({ root, observe: () => true });
  },
  known: { K4: C12, K5: C12, K10 },
};

/** A held run cut for `step-down`, whose grace keeps a file that ended whole. */
const stepDown: Pack = { ...base, name: "vitest step-down", cut: "step-down" };

export const vitest: Pack = {
  ...base,
  variants: [
    { name: "step-down", scenarios: ["K8"], pack: stepDown },
    {
      // 011 `reviews/0.1.287.md` B1: an interrupted `it.fails` whose cleanup throws reads as passed.
      name: "it.fails, step-down",
      scenarios: ["K8"],
      pack: {
        ...stepDown,
        name: "vitest it.fails step-down",
        text: (module, of) =>
          module.kind === "held"
            ? held(
                module,
                "it.fails",
                `afterEach((ctx) => {\n  if (ctx.signal.aborted) throw new Error("cleanup aborted");\n});`,
              )
            : text(module, of),
      },
    },
  ],
};
