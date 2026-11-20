// Throwaway: in a node --test child only, root-level hooks record each test's outcome; the file
// goes to an env var so processes the test spawns inherit it.
"use strict";
const fs = require("node:fs");
const out = process.env.PROBE_OUT;
const ctx = process.env.NODE_TEST_CONTEXT;
const own = out && ctx === "child-v8" && !process.env.PROBE_FILE;
if (own) process.env.PROBE_FILE = process.argv[1];
fs.appendFileSync(out, JSON.stringify({ pid: process.pid, kind: "start", ctx: ctx ?? null, argv1: (process.argv[1] ?? "").replace(/^.*\/fixture\//, ""), file: (process.env.PROBE_FILE ?? "").replace(/^.*\/fixture\//, "") }) + "\n");
if (own) {
  const t0 = new Map();
  const { beforeEach, afterEach } = require("node:test");
  beforeEach((t) => { t0.set(t, performance.now()); });
  afterEach((t) => {
    try { fs.appendFileSync(out, JSON.stringify({ pid: process.pid, kind: "result", file: process.env.PROBE_FILE.replace(/^.*\/fixture\//, ""), fullName: t.fullName, passed: t.passed, ms: +(performance.now() - (t0.get(t) ?? 0)).toFixed(2) }) + "\n"); } catch {}
  });
}
