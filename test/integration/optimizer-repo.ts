import { BASE, OLD, readsNew } from "./stamps-repo.js";

/*
 * Task 001-176 (reviews wave-13d S1 to wave-13f B4): configs that turn
 * Vitest's dependency optimizer on for `local-pkg`, an alias of `src/mod.js`,
 * in each place a project can be configured. `src/mod.js` holds `OLD`, so the
 * bytes on disk fail and a bundle of transient `NEW` passes.
 */

const config = (head: string, body: string) =>
  `import { defineConfig } from "vitest/config";\n${head}export default defineConfig(${body});\n`;

const ALIAS = 'resolve: { alias: { "local-pkg": resolve(import.meta.dirname, "src/mod.js") } }';
const OPTIMIZER = `deps: {
      optimizer: {
        ssr: { enabled: true, include: ["local-pkg"] },
        client: { enabled: true, include: ["local-pkg"] },
      },
    }`;
const RESOLVE = 'import { resolve } from "node:path";\n';

const COMMON: Readonly<Record<string, string>> = {
  ...BASE,
  "src/mod.ts": "",
  "src/mod.js": OLD,
  "test/optimized.test.ts": readsNew("local-pkg"),
};

/** Review wave-13f B3: a project with a config file of its own, which the root config lists. */
export const SEPARATE: Readonly<Record<string, string>> = {
  ...COMMON,
  "vitest.config.ts": config("", '{ test: { projects: ["./vitest.p.config.ts"] } }'),
  "vitest.p.config.ts": config(
    RESOLVE,
    `{
  ${ALIAS},
  test: {
    name: "p",
    include: ["test/*.test.ts"],
    ${OPTIMIZER},
  },
}`,
  ),
};

/** An inline project of the root config, with an alias of its own (so a server of its own). */
export const INLINE: Readonly<Record<string, string>> = {
  ...COMMON,
  "vitest.config.ts": config(
    RESOLVE,
    `{
  test: {
    projects: [{
      ${ALIAS},
      test: { name: "i", include: ["test/*.test.ts"], ${OPTIMIZER} },
    }],
  },
}`,
  ),
};
