// Throwaway probe for 016-34: runs every timed job, each sample behind the
// load gate, into /tmp/bc34/out/samples.jsonl. Run only in an agreed turn.
// argv[2]: samples per configuration (default 25). Every job runs under
// `nice -n 10`, as Squeal's own check processes do, with HOME, XDG_* and
// TMPDIR under /tmp/bc34. Each cold sample gets a fresh TMPDIR and compile
// cache, so no V8 code cache survives from an earlier sample (ESLint's CLI
// enables one in TMPDIR by itself).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const B = "/tmp/bc34";
const n = Number(process.argv[2] ?? 25);
const out = `${B}/out/samples.jsonl`;
const LOAD_MAX = 24;
const sets = {
  trivial: ["inproc", "worker", "rpc", "command", "command-cc"],
  eslint: ["inproc", "worker", "rpc", "command", "command-cc", "command-cli"],
};

function job(spec, tmp) {
  mkdirSync(tmp, { recursive: true });
  const full = { root: `${B}/tools/work`, eslintDir: `${B}/tools`, out, loadMax: LOAD_MAX, ...spec };
  execFileSync("nice", ["-n", "10", process.execPath, join(HERE, "sample.mjs"), JSON.stringify(full)], {
    stdio: "inherit",
    env: { PATH: process.env.PATH, HOME: `${B}/home`, XDG_RUNTIME_DIR: `${B}/run`, XDG_CONFIG_HOME: `${B}/config`, TMPDIR: tmp },
  });
}
const log = (text) => console.log(`${new Date().toISOString()} load ${readFileSync("/proc/loadavg", "utf8").trim()} ${text}`);

log(`start, ${n} samples per configuration`);
job({ mode: "hint", bindings: ["inproc", "worker", "rpc"], check: "trivial", n }, `${B}/tmp/warm`);
log("hint done");
for (const check of ["trivial", "eslint"]) {
  job({ mode: "warm", bindings: sets[check], check, n, warmup: 3, compileCache: `${B}/tmp/warm/cc` }, `${B}/tmp/warm`);
  log(`warm ${check} done`);
}
for (let i = 0; i < n; i++) {
  for (const check of ["trivial", "eslint"])
    for (const binding of sets[check]) {
      const tmp = `${B}/tmp/cold`;
      rmSync(tmp, { recursive: true, force: true });
      job({ mode: "cold", bindings: [binding], check, compileCache: `${tmp}/cc` }, tmp);
    }
  log(`cold round ${i + 1} done`);
}
log("end");
