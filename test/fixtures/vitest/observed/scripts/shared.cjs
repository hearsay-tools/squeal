// Started with `env: SHARE_ENV`; reads, and runs a Node child that reads (review wave 12d, B4).
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { parentPort } = require("node:worker_threads");

const child = execFileSync(process.execPath, [join(__dirname, "descendant.cjs")], {
  encoding: "utf8",
});
parentPort.postMessage(`${readFileSync(join(__dirname, "../data/shared.txt"), "utf8").trim()}:${child}`);
