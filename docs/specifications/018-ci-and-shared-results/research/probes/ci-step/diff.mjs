// throwaway: leaf paths whose values differ between two dump.mjs outputs
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const flat = (v, p = "", o = {}) => { if (v && typeof v === "object") { for (const k of Object.keys(v)) flat(v[k], p ? `${p}.${k}` : k, o); if (!Object.keys(v).length) o[p] = JSON.stringify(v); } else o[p] = JSON.stringify(v); return o; };
const fa = flat(a), fb = flat(b);
for (const k of [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()) if (fa[k] !== fb[k]) console.log(`${k}: ${fa[k]} -> ${fb[k]}`);
