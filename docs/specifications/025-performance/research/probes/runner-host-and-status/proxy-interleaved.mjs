// Throwaway probe for research 025-12 (D12): does the wrapper's D7 carry remove Node's
// NODE_USE_ENV_PROXY start cost? Interleaved, so load drift hits every variant alike.
//   node proxy-interleaved.mjs <plugin dir> <cwd> <rounds>
// Variants per round, each `--version` and `status --json`, warm compile cache in a scratch
// XDG_CACHE_HOME: wrapper and plain node, each without and with NODE_USE_ENV_PROXY=1 and
// HTTPS_PROXY to a closed local port. Prints the median ms per variant and the load.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [plugin, cwd, roundsArg] = process.argv.slice(2);
const cache = mkdtempSync(join(tmpdir(), "cc-proxy-"));
const base = { ...process.env, XDG_CACHE_HOME: cache };
for (const k of ["NODE_COMPILE_CACHE", "SQUEAL_OWN_COMPILE_CACHE", "NODE_USE_ENV_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) delete base[k];
const proxied = { ...base, NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://127.0.0.1:9" };
const direct = (env) => ({ ...env, NODE_COMPILE_CACHE: join(cache, "squeal/compile-cache"), SQUEAL_OWN_COMPILE_CACHE: "1" });
const run = {
  wrapper: (args, env) => ["sh", [join(plugin, "bin/squeal"), ...args], env],
  node: (args, env) => [process.execPath, ["--disable-warning=ExperimentalWarning", join(plugin, "dist/cli/squeal.mjs"), ...args], direct(env)],
};
const times = new Map();
const load = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const l0 = load();
for (let r = 0; r < Number(roundsArg) + 1; r++) {
  for (const form of [["--version"], ["status", "--json"]]) for (const [name, make] of Object.entries(run)) for (const [p, env] of [["-", base], ["proxy", proxied]]) {
    const [cmd, args, e] = make(form, env);
    const t0 = performance.now();
    spawnSync(cmd, args, { cwd, env: e, maxBuffer: 64 << 20 });
    const ms = performance.now() - t0;
    if (r === 0) continue;
    const key = `${form.join(" ")} | ${name} | ${p}`;
    times.set(key, [...(times.get(key) ?? []), ms]);
  }
}
rmSync(cache, { recursive: true, force: true });
for (const [key, xs] of times) {
  const s = xs.sort((a, b) => a - b);
  console.log(`${key} | median ${Math.round(s[Math.floor(s.length / 2)])} | min ${Math.round(s[0])} | n ${s.length}`);
}
console.log(`load1 ${l0} -> ${load()}, ${process.version}`);
