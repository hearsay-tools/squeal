// The fixture's "build": copies src/tool.mjs to dist/ and writes a stamp, like cezar's tsc + vite step.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
let spin = 0;
for (let i = 0; i < 2e6; i++) spin += i % 7; // a little work, as a build does
writeFileSync("dist/tool.mjs", readFileSync("src/tool.mjs"));
writeFileSync("dist/stamp.json", JSON.stringify({ spin }));
