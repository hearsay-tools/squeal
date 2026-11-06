// Throwaway probe for row 017-30. Read-only. Times the oxlint config walk two
// ways on one worktree: the walk before 017-30 (every folder but
// `node_modules` and `.git`, as `../../../011-core/research/probes/issue-154/configwalk.mjs`),
// and the walk after it: one `git ls-files --others --ignored
// --exclude-standard --directory -z`, then the same walk that skips the
// folders git named (`findConfigs` in src/core/lint/provider/oxlint/configs.ts).
// It writes nothing; git runs with GIT_OPTIONAL_LOCKS=0. Run it only at a
// one-minute load at or below 24.
//
//   node configwalk-ignored.mjs <worktree-root> [rounds]
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";

const root = process.argv[2];
const rounds = Number(process.argv[3] ?? 5);
if (root === undefined) {
  console.error("usage: node configwalk-ignored.mjs <worktree-root> [rounds]");
  process.exit(2);
}
const SKIP = new Set(["node_modules", ".git"]);
const CONFIG_NAMES = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"];

function walk(ignored) {
  let dirs = 0;
  let entries = 0;
  const found = [];
  const visit = (dir) => {
    let list;
    try {
      list = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    dirs++;
    entries += list.length;
    for (const entry of list) {
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !ignored.has(rel)) visit(rel);
      } else if (CONFIG_NAMES.includes(entry.name)) found.push(rel);
    }
  };
  visit("");
  return { dirs, entries, configs: found.sort() };
}

function ignoredFolders() {
  const out = execFileSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 1 << 28 },
  ).toString("utf8");
  return new Set(
    out
      .split("\0")
      .filter((p) => p.endsWith("/"))
      .map((p) => p.slice(0, -1)),
  );
}

const time = (fn) => {
  const start = performance.now();
  const value = fn();
  return { ms: Math.round((performance.now() - start) * 10) / 10, value };
};

const runs = [];
for (let i = 0; i < rounds; i++) {
  const load1 = loadavg()[0];
  const before = time(() => walk(new Set()));
  const git = time(ignoredFolders);
  const after = time(() => walk(git.value));
  runs.push({
    load1,
    beforeMs: before.ms,
    gitMs: git.ms,
    afterWalkMs: after.ms,
    afterMs: Math.round((git.ms + after.ms) * 10) / 10,
    before: { dirs: before.value.dirs, entries: before.value.entries },
    after: { dirs: after.value.dirs, entries: after.value.entries, ignored: git.value.size },
  });
  if (i === rounds - 1) {
    console.log(
      JSON.stringify(
        { root, runs, configsBefore: before.value.configs, configsAfter: after.value.configs },
        null,
        1,
      ),
    );
  }
}
