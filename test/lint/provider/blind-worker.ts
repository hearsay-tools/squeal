import fs from "node:fs";

/*
 * The ESLint worker with its file reads unseen, as under a config loader
 * the worker does not know (review 0.1.348 B2): the worker sets its
 * recorder, then this entry puts the original `readFileSync` back.
 */

const { readFileSync } = fs;
await import("../../../src/core/lint/provider/worker.js");
fs.readFileSync = readFileSync;
