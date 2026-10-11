// What every cell shares, built once under the scratch root: the plugins of the commit under
// test (`git archive`, so a dirty checkout never leaks into a run) and the fixture's Vitest.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EVALS = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = join(EVALS, "..");

/** The full hash of `ref` in this repository. */
export function resolveCommit(ref = "HEAD") {
  return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
}

/** `<root>/pin-base/<commit>`: the commit's plugins and marketplaces, extracted once. */
export function pinBase(root, commit) {
  const dir = join(root, "pin-base", commit);
  if (existsSync(join(dir, ".done"))) return dir;
  const partial = `${dir}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  const tar = execFileSync(
    "git",
    ["archive", commit, "plugins", ".agents/plugins", ".claude-plugin"],
    { cwd: REPO, maxBuffer: 1 << 30 },
  );
  execFileSync("tar", ["-x", "-C", partial], { input: tar });
  writeFileSync(join(partial, ".done"), `${commit}\n`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(partial, dir);
  return dir;
}

/** Squeal's version in a pin: the Claude Code plugin's manifest. */
export function pinVersion(pin) {
  return JSON.parse(
    readFileSync(join(pin, "plugins/claude-code/.claude-plugin/plugin.json"), "utf8"),
  ).version;
}

/** `<root>/nm/node_modules`: the fixture's devDependencies, installed once and copied into each cell. */
export function fixtureModules(root) {
  const dir = join(root, "nm");
  if (existsSync(join(dir, ".done"))) return join(dir, "node_modules");
  const pkg = JSON.parse(readFileSync(join(EVALS, "ledgerline/package.json"), "utf8"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ private: true, devDependencies: pkg.devDependencies }),
  );
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], {
    cwd: dir,
    stdio: "ignore",
  });
  writeFileSync(join(dir, ".done"), "");
  return join(dir, "node_modules");
}
