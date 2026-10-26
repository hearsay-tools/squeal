// Throwaway probe for 016-34: writes the scratch project under argv[2]
// (/tmp/bc34/tools/work, inside the ESLint install so its config resolves
// @eslint/js). Five sources of about 230 lines, each with one unused
// variable (an ESLint error), and one trivial check per source.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(root, "checks"), { recursive: true });
writeFileSync(
  join(root, "eslint.config.mjs"),
  `import js from "@eslint/js";\nexport default [js.configs.recommended, { languageOptions: { sourceType: "module" } }];\n`,
);
const fn = (name, i) => `
export function ${name}${i}(items, limit) {
  const seen = new Map();
  let total = 0;
  for (const item of items) {
    if (item === null || item === undefined) continue;
    const key = typeof item === "object" ? JSON.stringify(item) : String(item);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    total += key.length;
    if (total > limit) break;
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, ${i + 3});
}
`;
for (const name of ["a", "b", "c", "d", "e"]) {
  let text = `// fixture source ${name}\nconst unused${name} = 1;\n`;
  for (let i = 0; i < 18; i++) text += fn(name, i);
  writeFileSync(join(root, "src", `${name}.js`), text);
  writeFileSync(
    join(root, "checks", `${name}.check.js`),
    `import { ${name}0 } from "../src/${name}.js";\nexport const result = ${name}0([1, 2, 2], 10);\n`,
  );
}
console.log(`fixture at ${root}`);
