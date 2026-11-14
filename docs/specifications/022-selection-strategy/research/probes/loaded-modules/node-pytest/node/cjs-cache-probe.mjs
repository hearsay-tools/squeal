// Throwaway: does a registerHooks resolve hook see a require() of an already
// loaded CJS module from (1) a sibling file in the same directory, (2) a file
// in another directory, (3) the same file again? Run: node cjs-cache-probe.mjs <fixture dir>
import { registerHooks, createRequire } from "node:module";
const seen = [];
registerHooks({ resolve(s, c, n) { const r = n(s, c); seen.push(`${(c.parentURL ?? "").split("/").slice(-2).join("/")} -> ${s}`); return r; } });
const dir = process.argv[2];
createRequire(`${dir}/a.test.mjs`)("./cjs-dep.cjs");
const mark = (label) => { console.log(label, JSON.stringify(seen.splice(0))); };
mark("first require from a.test.mjs:");
createRequire(`${dir}/b.test.mjs`)("./cjs-dep.cjs");
mark("sibling b.test.mjs, same dir, cached:");
createRequire(`${dir}/foo/x.js`)("../cjs-dep.cjs");
mark("foo/x.js, other dir, cached:");
createRequire(`${dir}/a.test.mjs`)("./cjs-dep.cjs");
mark("a.test.mjs again:");
await import(`${dir}/esm-dep.mjs`); mark("import esm-dep (fresh):");
await import(`${dir}/esm-dep.mjs`); mark("import esm-dep again (cached):");
