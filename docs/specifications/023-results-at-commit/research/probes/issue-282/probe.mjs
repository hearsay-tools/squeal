// Throwaway read-only source probe; no runner, daemon, install or fixture repository.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { needsOf } from "../../../../../../src/cli/status-at-run-select.ts";
import { heldAt } from "../../../../../../src/core/commit/held.ts";
import { listingsHeld } from "../../../../../../src/core/daemon/commit-listings.ts";

const root = resolve(import.meta.dirname, "../../../../../..");
const load = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const cpus = (await import("node:os")).cpus().length;
if (load > cpus) {
  console.log(JSON.stringify({ skipped: "one-minute load exceeds CPU count", load, cpus }));
  process.exit(0);
}
const folder = "src/runners/";
const blob = "src/runners/process/recorders.ts";
const needs = await needsOf({ root, tree: root, commit: "HEAD" });
const held = await heldAt(root, "HEAD");
const listed = listingsHeld(root, held.blobs);
const file = (path) => ({ ref: { project: "synthetic", path: "synthetic.test.ts" },
  at: { key: "synthetic-key", stored: [], loads: [path] } });
const found = {
  load, cpus,
  folder,
  proofPreflightNeeds: needs(file(folder)),
  commitHoldsBlob: held.has(blob),
  commitHoldsFolderAsBlob: held.has(folder),
  commitDaemonListingHeld: listed(folder),
  blobPreflightNeeds: needs(file(blob)),
};
console.log(JSON.stringify(found, null, 2));
assert.equal(found.proofPreflightNeeds, folder);
assert.equal(found.commitHoldsFolderAsBlob, false);
assert.equal(found.commitDaemonListingHeld, true);
assert.equal(found.blobPreflightNeeds, null);
