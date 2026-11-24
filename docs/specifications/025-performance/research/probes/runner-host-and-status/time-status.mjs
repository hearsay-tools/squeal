// Throwaway probe for research 025-12 (D12): wall time of `squeal status` forms, run in a
// scratch clone whose daemon is idle (here: on `squeal hold`, with the named file current). No product code changes.
//   node time-status.mjs <root> <plugin dir> <scratch bundles dir> <trials> <named test file>
// <plugin dir> is plugins/claude-code (its bin/squeal and dist/cli/squeal.mjs, as shipped);
// <scratch bundles dir> holds status-bundle.mts's output (cli/status.mjs and the timed ones).
// Compile cache modes: cold = a new empty cache directory per trial; warm = one directory
// filled by two untimed runs first; off = NODE_DISABLE_COMPILE_CACHE=1. Proxy: with "proxy",
// NODE_USE_ENV_PROXY=1 and HTTPS_PROXY to a closed local port (status makes no request).
// Prints one JSON line per configuration: min, median, p90, max in ms, and the 1-minute load
// before and after; and, for the timed bundles, the median of each phase.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [root, plugin, scratch, trialsArg, named] = process.argv.slice(2);
const trials = Number(trialsArg);
const load1 = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const node = process.execPath;
const quiet = "--disable-warning=ExperimentalWarning";
const shipped = join(plugin, "dist/cli/squeal.mjs");

const forms = {
  version: ["--version"],
  status: ["status"],
  json: ["status", "--json"],
  wait: ["status", "--wait", "60000", named],
};
// How each variant starts. The wrapper sets NODE_COMPILE_CACHE itself from XDG_CACHE_HOME.
const variants = {
  wrapper: (args) => ["sh", [join(plugin, "bin/squeal"), ...args]],
  node: (args) => [node, [quiet, shipped, ...args]],
  "status-bundle": (args) => [node, [quiet, join(scratch, "cli/status.mjs"), ...args]],
  "full-timed": (args) => [node, [quiet, join(scratch, "cli/squeal-timed.mjs"), ...args]],
  "status-timed": (args) => [node, [quiet, join(scratch, "cli/status-timed.mjs"), ...args]],
};

const baseEnv = { ...process.env };
for (const k of ["NODE_COMPILE_CACHE", "SQUEAL_OWN_COMPILE_CACHE", "NODE_USE_ENV_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "NODE_DISABLE_COMPILE_CACHE"]) delete baseEnv[k];

function envFor(variant, cache, proxy, cacheDir) {
  const env = { ...baseEnv, XDG_CACHE_HOME: cacheDir };
  // The wrapper derives the cache from XDG_CACHE_HOME; the direct runs get what it would export.
  if (variant !== "wrapper" && cache !== "off") {
    env.NODE_COMPILE_CACHE = join(cacheDir, "squeal/compile-cache");
    env.SQUEAL_OWN_COMPILE_CACHE = "1";
  }
  if (cache === "off") env.NODE_DISABLE_COMPILE_CACHE = "1";
  if (proxy) {
    env.NODE_USE_ENV_PROXY = "1";
    env.HTTPS_PROXY = "http://127.0.0.1:9";
  }
  return env;
}

function once(variant, form, env) {
  const [cmd, args] = variants[variant](forms[form]);
  const t0 = process.hrtime.bigint();
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: "utf8", maxBuffer: 64 << 20 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // Exit 2 is a usage error or a crash: the form did not run as measured.
  if (r.status === 2 || r.status === null) throw new Error(`${variant} ${form}: exit ${r.status}: ${r.stderr.slice(-400)}`);
  const marks = r.stderr.split("\n").filter((l) => l.startsWith("{\"imported\"")).map((l) => JSON.parse(l))[0];
  return { ms, marks, bytes: r.stdout.length, exit: r.status };
}

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] * 10) / 10;
};
const stats = (xs) => ({ min: q(xs, 0), median: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) });

function measure(variant, form, cache, proxy) {
  const before = load1();
  const times = [];
  const phases = [];
  let bytes = 0;
  const exits = new Set();
  const warmDir = mkdtempSync(join(tmpdir(), "cc-warm-"));
  if (cache === "warm") for (let i = 0; i < 2; i++) once(variant, form, envFor(variant, cache, proxy, warmDir));
  for (let i = 0; i < trials; i++) {
    const dir = cache === "cold" ? mkdtempSync(join(tmpdir(), "cc-cold-")) : warmDir;
    const r = once(variant, form, envFor(variant, cache, proxy, dir));
    times.push(r.ms);
    bytes = r.bytes;
    exits.add(r.exit);
    if (r.marks) phases.push(r.marks);
    if (cache === "cold") rmSync(dir, { recursive: true, force: true });
  }
  rmSync(warmDir, { recursive: true, force: true });
  const phase = phases.length === 0 ? undefined : {
    imported: q(phases.map((p) => p.imported), 0.5),
    read: form === "status" || form === "json" ? q(phases.map((p) => p.read1 - p.read0), 0.5) : undefined,
    format: form === "status" || form === "json" ? q(phases.map((p) => p.out - p.read1), 0.5) : undefined,
    afterImportToDone: q(phases.map((p) => p.done - p.imported), 0.5),
    done: q(phases.map((p) => p.done), 0.5),
  };
  console.log(JSON.stringify({ variant, form, cache, proxy, trials, ...stats(times), stdoutBytes: bytes, exits: [...exits], phase, load1Before: before, load1After: load1() }));
}

// Baselines: an empty Node, and sh starting.
for (const [name, cmd, args] of [["node -e 0", node, ["-e", "0"]], ["sh -c :", "sh", ["-c", ":"]]]) {
  const times = [];
  for (let i = 0; i < trials; i++) {
    const t0 = process.hrtime.bigint();
    spawnSync(cmd, args, { env: baseEnv });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  console.log(JSON.stringify({ variant: name, trials, ...stats(times), load1: load1() }));
}
for (const proxy of [false, true]) {
  for (const cache of ["off", "cold", "warm"]) {
    for (const form of ["version", "status", "json", "wait"]) {
      for (const variant of ["wrapper", "node", "status-bundle"]) {
        if (variant === "status-bundle" && form === "version") continue;
        measure(variant, form, cache, proxy);
      }
    }
  }
}
for (const variant of ["full-timed", "status-timed"]) {
  for (const form of ["status", "json", "wait"]) measure(variant, form, "warm", false);
  measure(variant, "status", "cold", false);
}
