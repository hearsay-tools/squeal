import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const remove = fs.rmSync;
let held = false;
fs.rmSync = function (path, ...args) {
  if (!held && String(path).endsWith(".starting") && fs.existsSync(path)) {
    held = true;
    fs.writeFileSync(process.env.PROBE_MARKER, "registered-before-start-marker-removal");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
  }
  return remove.call(this, path, ...args);
};
syncBuiltinESMExports();
