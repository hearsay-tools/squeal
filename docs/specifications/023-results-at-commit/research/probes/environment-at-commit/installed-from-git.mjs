// Throwaway (environment-at-commit): the installed-dependency part of the
// environment hash, computed from the committed pnpm-lock.yaml at a commit
// (git show), against the value a daemon recorded. Re-implements, for this
// probe only, the whole-fingerprint branch of installedDependencies()
// (src/core/keys/environment.ts at d2678e570) and withoutLinkedSpecifiers()
// (src/core/keys/pnpm-lockfile.ts). pnpm 12 writes the committed file as two
// YAML documents; the installed node_modules/.pnpm/lock.yaml is the second.
// Usage: node installed-from-git.mjs <repo> <commit> [<installed lock.yaml>]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const [repo, commit, installed] = process.argv.slice(2);
const committed = execFileSync("git", ["-C", repo, "show", `${commit}:pnpm-lock.yaml`], { encoding: "utf8", maxBuffer: 1 << 28 });
const docs = committed.split(/^---\n/m);
const second = docs.length > 2 ? docs[2] : committed;
const linked = (line, next) => {
  const indent = /^( +)specifier: /.exec(line)?.[1];
  return indent !== undefined && next.startsWith(`${indent}version: link:`);
};
const filter = (text) => { const l = text.split("\n"); return l.filter((x, i) => !linked(x, l[i + 1] ?? "")).join("\n"); };
const whole = (text) => createHash("sha256").update("node_modules/.pnpm/lock.yaml\0").update(`squeal-installed/2\0${filter(text)}`).digest("hex");
const out = { commit, documents: docs.length - 1, wholeFromGit: whole(second) };
if (installed) {
  const t = readFileSync(installed, "utf8");
  out.installedEqualsSecondDocument = t === second;
  out.wholeFromInstall = whole(t);
}
console.log(JSON.stringify(out));
