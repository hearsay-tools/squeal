// 011-149 probe (throwaway): the oxc reprint without comments that K3 hashes. Usage: node reprint.mjs (from q2/)
import { minifySync } from "rolldown/utils";
const code = `/** doc */\n// c\nexport function f(a) {\n\t// inside\n\treturn /*#__PURE__*/ g(a.length);\n}\n/*! legal */\nfunction g(n) { return n; }\n`;
const r = minifySync("x.js", code, { compress: false, mangle: false, module: true, codegen: { removeWhitespace: false, legalComments: "none" } });
console.log(JSON.stringify(r.code), r.errors);
