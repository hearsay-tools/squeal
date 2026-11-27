// Throwaway probe preload (row 011-428): after the store process writes its "serving" line,
// hold its main thread for 1.5 s with Atomics.wait (no CPU work), the place a slow runner can
// deschedule it. Nothing else changes.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const original = fs.writeSync;
fs.writeSync = function (fd, data, ...rest) {
  const written = original.call(this, fd, data, ...rest);
  if (typeof data === "string" && data.includes("store process: serving ")) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500);
  }
  return written;
};
syncBuiltinESMExports();
