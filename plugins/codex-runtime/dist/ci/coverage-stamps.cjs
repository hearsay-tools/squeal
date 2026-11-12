// Spec 020 D13 (row 020-08a): what `coverage.cjs` sets in the run's Vite
// servers before its `start`. Each server may load Squeal's provider (row
// 013-08), and each plugin container's `load` stamps the bytes Vite read
// (`SourceStamps`), which a record's sources name. With the project's own
// V8 provider (D19) only the stamps are set. Moved out of `coverage.cjs`
// unchanged (row 020-26ab). CommonJS with Node built-ins only.
"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const clock = require("./clock.cjs");
const { projectFile } = require("./coverage-drops.cjs");

/** Row 013-08: each Vite server of the instance may load the provider, by its path and real path. */
function allow(vitest, provider) {
  const files = new Set([provider, fs.realpathSync.native(provider)]);
  for (const server of new Set([vitest.vite, ...vitest.projects.map((p) => p.vite)])) {
    const allowed = server.config.server.fs.allow;
    for (const file of files) if (!allowed.includes(file)) allowed.push(file);
  }
}

function environmentsOf(vitest) {
  return new Set(vitest.projects.flatMap((p) => Object.values(p.vite.environments ?? {})));
}

/** As `SourceStamps.attach`: the sha1 of the bytes each container's `load` read, by module ID. */
function attachStamps(vitest, root, stamps) {
  for (const environment of environmentsOf(vitest)) {
    const container = environment.pluginContainer;
    if (stamps.has(container)) continue;
    const reads = new Map();
    stamps.set(container, reads);
    const load = container.load.bind(container);
    // Row 018-29: the hash is on the clock; the read, which waits, is not.
    const stamp = clock.timed((id, bytes) => {
      reads.set(id, createHash("sha1").update(bytes).digest("hex"));
    });
    container.load = async (id, ...rest) => {
      if (projectFile(id, root) !== null) {
        try {
          stamp(id, await fs.promises.readFile(id));
        } catch {
          reads.delete(id);
        }
      }
      return load(id, ...rest);
    };
  }
}

module.exports = { allow, attachStamps };
