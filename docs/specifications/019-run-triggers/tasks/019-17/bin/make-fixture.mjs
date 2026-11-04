#!/usr/bin/env node
// Throwaway probe for 019-17. Not product code. Runs as agent.
//   node make-fixture.mjs <worktree> <dest> <delay ms>
// The Part A fixture (test/e2e/run-triggers-fixture.ts) as a git repository at <dest> for the
// dogfood: test/fixtures/e2e/project, its sources, the two e2e files, src/delay.ts with
// <delay ms>, and a package.json naming this worktree's Vitest and oxlint, so the e2e user
// installs them itself. One commit, `fixture`, with no squeal.config.json: setup.sh commits
// each configuration on its own branch.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [wt, dest, delay] = process.argv.slice(2);
if (!wt || !dest || !delay) {
  console.error("usage: make-fixture.mjs <worktree> <dest> <delay ms>");
  process.exit(2);
}
const fixture = await import(join(wt, "test/e2e/run-triggers-fixture.ts"));
const sources = await import(join(wt, "test/e2e/sources.ts"));
const version = (name) =>
  JSON.parse(readFileSync(join(wt, "node_modules", name, "package.json"), "utf8")).version;

rmSync(dest, { recursive: true, force: true });
cpSync(join(wt, "test/fixtures/e2e/project"), dest, { recursive: true });
renameSync(join(dest, "_gitignore"), join(dest, ".gitignore"));
const write = (path, text) => {
  mkdirSync(dirname(join(dest, path)), { recursive: true });
  writeFileSync(join(dest, path), text);
};
const { files } = fixture.triggersFixture(true);
for (const [path, text] of Object.entries(files)) write(path, text);
write("src/math.ts", sources.MATH());
write("src/strings.ts", sources.STRINGS());
write("src/delay.ts", fixture.DELAY(Number(delay)));
write(
  "package.json",
  `${JSON.stringify(
    {
      name: "shout",
      private: true,
      type: "module",
      scripts: { test: "vitest run" },
      devDependencies: { oxlint: version("oxlint"), vitest: version("vitest") },
    },
    null,
    2,
  )}\n`,
);
const git = (...args) => execFileSync("git", args, { cwd: dest, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.email=dogfood@squeal-e2e.invalid", "-c", "user.name=dogfood", "commit", "-qm", "fixture");
console.log(execFileSync("git", ["log", "--oneline", "-1"], { cwd: dest, encoding: "utf8" }).trim());
