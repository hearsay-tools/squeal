// 011-149 probe (throwaway): which comments Vite's oxc transform keeps. Usage: node oxc-comments.mjs (from q2/)
import { transformWithOxc } from "vite";
const src = `/** doc */\n// line comment\nexport function f(a: string /* inline */): number {\n  // inside\n  return /*#__PURE__*/ g(a.length); /* v8 ignore next */\n}\n/*! legal */\nfunction g(n: number) { return n }\n`;
const r = await transformWithOxc(src, "/tmp/to149/q2/x.ts", { sourcemap: true });
console.log(r.code); console.log(r.map.mappings);
