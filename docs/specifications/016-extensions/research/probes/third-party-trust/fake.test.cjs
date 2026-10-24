// Stands in for a test file whose checks shell out to non-Node tools.
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const bin = process.env.PROBE_BIN;
fs.readFileSync("data-node.txt");
execFileSync("python3", ["-I", "-c", "open('data-py.txt').read()"]);
execFileSync(`${bin}/reader-dyn`, ["data-dyn.txt"], { stdio: "inherit" });
execFileSync(`${bin}/reader-static`, ["data-static.txt"], { stdio: "inherit" });
execFileSync(`${bin}/reader-static`, ["--env"], {
  stdio: "inherit",
  env: { ...process.env, PROBE_DATA: "data-env.txt" },
});
execFileSync("sh", ["-c", "cat data-sh.txt > /dev/null"]);
console.log("fake test done");
