// 017-13 probe: append a block to svelte's eslint.config.js that turns the config's own TODO
// rule @typescript-eslint/no-unused-vars on as a warning in the compiler, then nothing else.
const fs = require("node:fs");
const p = "eslint.config.js";
const s = fs.readFileSync(p, "utf8");
const block = `\t{\n\t\t// dogfood 017-13: the TODO rule above, as a warning, in the compiler only\n\t\tfiles: ['packages/svelte/src/compiler/**/*.js'],\n\t\trules: {\n\t\t\t'@typescript-eslint/no-unused-vars': 'warn'\n\t\t}\n\t}\n];\n`;
if (!s.trimEnd().endsWith("];")) throw new Error("unexpected end");
fs.writeFileSync(p, s.trimEnd().replace(/\n\];$/, ",\n") + block);
