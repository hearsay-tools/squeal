// Preload for `node --import`: records every module the oxlint process's
// JavaScript side loads and every path it reads with fs, then writes the list
// to $OBSERVE_OUT at exit. It sees JS plugins and JS configs; it cannot see
// what the Rust binding or tsgolint read.
import fs from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const seen = new Set();
const out = process.env.OBSERVE_OUT;
const add = (p) => {
  try {
    if (typeof p === "string") seen.add(p.startsWith("file:") ? fileURLToPath(p) : p);
    else if (p instanceof URL) seen.add(fileURLToPath(p));
  } catch {}
};
registerHooks({
  load(url, context, next) {
    if (url.startsWith("file:")) add(url);
    return next(url, context);
  },
});
for (const name of ["readFileSync", "readFile", "openSync", "open", "createReadStream"]) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) {
    add(p);
    return orig.call(this, p, ...rest);
  };
}
const origP = fs.promises.readFile;
fs.promises.readFile = function (p, ...rest) {
  add(p);
  return origP.call(this, p, ...rest);
};
// Named ESM imports of node:fs (`import { readFileSync } from "node:fs"`) see
// the patched functions only after this call.
syncBuiltinESMExports();
process.on("exit", () => {
  if (out) fs.writeFileSync(out, JSON.stringify([...seen]));
});
