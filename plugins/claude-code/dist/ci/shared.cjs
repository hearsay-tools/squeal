// The CI hooks Vitest's and node:test's recordings share (spec 018 D24, row
// 018-47): the evidence, its descriptor and child wrappers and the clock, in
// `src/runners/ci-runtime/`, which names no runner. A bundle copies them
// beside this file into `dist/ci/`; in the sources they sit two folders up.
// Each loads from one path in a process, so each thread keeps one clock.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** The shared hook `name` (`clock.cjs`, ...), loaded. */
function shared(name) {
  const beside = path.join(__dirname, name);
  return require(
    fs.existsSync(beside) ? beside : path.join(__dirname, "..", "..", "ci-runtime", name),
  );
}

module.exports = { shared };
