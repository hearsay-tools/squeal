// Throwaway (026, daemonless-hooks). Times fresh processes, each case N times
// in rotation, under GNU time (wall, user, sys, max RSS). Skips a round while
// the one-minute load is over the limit. Prints one JSON line per run.
// Usage: node drive.mjs <wt> <fx> <dist> <common> <rounds> [load limit]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const [wt, fx, dist, common, roundsArg, limitArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 10);
const limit = Number(limitArg ?? 24);
const F1 = ["src/core/lint/provider/oxlint/provider.ts"];
const F3 = [...F1, "src/core/code/count/parser.ts", "src/core/scheduler/refinement.ts"];
const F5 = [...F3, "src/core/daemon/daemon.ts", "src/core/code/pass/pass.ts"];
const inline = `${dist}/cli/inline.mjs`;
const ox = `${wt}/node_modules/oxlint/bin/oxlint`;
const cases = [
  ["node-floor", ["node", "-e", "0"], fx],
  ["hook-bundle-floor", ["node", "--disable-warning=ExperimentalWarning", `${wt}/plugins/claude-code/dist/post-tool-batch.mjs`], `${dist}/..`],
  ["probe-none", ["node", inline, fx, common, "none", ...F1], fx],
];
for (const [n, files] of [[1, F1], [3, F3], [5, F5]]) {
  cases.push([`count-${n}`, ["node", inline, fx, common, "count", ...files], fx]);
  cases.push([`count+sqlite-${n}`, ["node", inline, fx, common, "sqlite", ...files], fx]);
  cases.push([`oxlint-provider-${n}`, ["node", inline, fx, common, "oxlint", ...files], fx]);
  cases.push([`oxlint-cli-${n}`, ["node", ox, "--format", "json", "--threads", "1", "--", ...files], fx]);
  cases.push([`both-${n}`, ["node", inline, fx, common, "both", ...files], fx]);
}
cases.push(["eslint-cli-1", ["node", `${wt}/node_modules/eslint/bin/eslint.js`, "-f", "json", "-c", `${fx}/probe.eslint.config.mjs`, "bench/lib.mjs"], fx]);
cases.push(["biome-lint-1", [`${wt}/node_modules/.bin/biome`, "lint", "--reporter=json", ...F1], fx]);
// CASES=extra: change detection and the hook side of a fire-and-exit helper.
if (process.env.CASES === "extra") {
  cases.length = 0;
  cases.push(["git-status", ["git", "status", "--porcelain=v2", "--untracked-files=normal"], fx]);
  cases.push(["git-diff-names", ["git", "diff", "--name-only", "HEAD"], fx]);
  const spawnHelper = `import { spawn } from "node:child_process"; spawn(process.execPath, [${JSON.stringify(inline)}, ${JSON.stringify(fx)}, ${JSON.stringify(common)}, "both", ...${JSON.stringify(F1)}], { detached: true, stdio: "ignore" }).unref();`;
  cases.push(["hook-spawns-helper", ["node", "--input-type=module", "-e", spawnHelper], fx]);
  cases.push(["wait-for-helper", ["sleep", "2"], fx]);
  cases.push(["node-floor", ["node", "-e", "0"], fx]);
}
const load = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
for (let r = 0; r < rounds; r++) {
  const l = load();
  if (l > limit) { console.log(JSON.stringify({ round: r, skipped: true, load: l })); spawnSync("sleep", ["30"]); r--; continue; }
  for (const [name, cmd, cwd] of cases) {
    const t = spawnSync("/usr/bin/time", ["-f", "TIME %e %U %S %M", ...cmd], { cwd, input: name.startsWith("hook") ? "{}" : "", encoding: "utf8" });
    const tl = t.stderr.trim().split("\n").filter((x) => x.startsWith("TIME ")).pop() ?? "";
    const [, e, u, s, m] = tl.split(" ");
    let probe = null;
    try { probe = JSON.parse(t.stdout.trim().split("\n").pop()); } catch {}
    console.log(JSON.stringify({ round: r, name, load: load(), status: t.status, wallMs: Math.round(Number(e) * 1000), cpuMs: Math.round((Number(u) + Number(s)) * 1000), maxRssMB: Math.round(Number(m) / 1024), marks: probe?.marks, lintNote: probe?.lintNote, functions: probe?.functions }));
  }
}
