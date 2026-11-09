// Throwaway probe for research/mutation-planning.md (row 015-125), question 1.
// cezar's .github/scripts/mutants-related.mjs, but for many file sets and printing the test files, not a count.
// Asks Vitest's related mode the question Stryker's dry run asks; runs no test. Run from a scratch cezar copy.
// usage (cwd = scratch cezar): node related.mjs <in.json: [{id, pkg, files}]> <out.json>
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

const [input, out] = process.argv.slice(2);
const require = createRequire(`${process.cwd()}/`);
const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
const sets = JSON.parse(readFileSync(input, "utf8"));
const result = {};
for (const pkg of [...new Set(sets.map((s) => s.pkg))]) {
  process.env.STRYKER_PROJECT = pkg;
  const vitest = await createVitest("test", { config: "vitest.stryker.config.ts", watch: false, reporters: [] });
  try {
    for (const s of sets.filter((x) => x.pkg === pkg)) {
      vitest.config.related = s.files.map((f) => resolve(f));
      const specs = await vitest.getRelevantTestSpecifications();
      result[s.id] = specs.map((sp) => relative(process.cwd(), sp.moduleId));
    }
  } finally {
    await vitest.close();
  }
}
writeFileSync(out, JSON.stringify(result));
console.log(Object.keys(result).length, "sets");
