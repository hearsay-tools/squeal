// The package's build, as CI runs it before test:package: copies src into dist
// and writes the CLI the e2e files spawn.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
copyFileSync("src/greet.mjs", "dist/greet.mjs");
writeFileSync("dist/index.js", 'export { greet } from "./greet.mjs";\n');
writeFileSync(
  "dist/cli.mjs",
  '#!/usr/bin/env node\nimport { greet } from "./greet.mjs";\nconsole.log(greet(process.argv[2] ?? "world"));\n',
);
