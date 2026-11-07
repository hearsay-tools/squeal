// Throwaway research probe. No daemon or test runner starts.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { treeSitterCounter } from "../../../../../../src/core/code/pass/counter.js";
import { runPass } from "../../../../../../src/core/code/pass/pass.js";
import type { PassSource, SourceFile } from "../../../../../../src/core/code/pass/types.js";
import {
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../../../../../src/core/code/store/open.js";
import { worktreeIdFor } from "../../../../../../src/core/fs/git-layout.js";
import { blobHash } from "../../../../../../src/core/hash/blob.js";
import { openStore } from "../../../../../../src/core/store/open.js";
import { DEFAULT_POLICY } from "../../../../../../src/core/types/policy.js";

const cli = process.argv[2];
assert(cli, "Pass an absolute packaged squeal CLI .mjs path");
const host = { at: new Date().toISOString(), load1: loadavg()[0], cpus: availableParallelism() };
console.log(JSON.stringify({ host }));
assert(host.load1 <= host.cpus, "Skip live probe: one-minute load exceeds CPU count");
const base = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(base, "run-"));
const commonDir = join(root, ".git");
const policy = {
  ...DEFAULT_POLICY,
  complexity: { ...DEFAULT_POLICY.complexity, enabled: true },
  coverage: { ...DEFAULT_POLICY.coverage, enabled: false },
};
execFileSync("git", ["init", "-q", root]);
writeFileSync(
  join(root, "squeal.config.json"),
  JSON.stringify({ complexity: { enabled: true }, coverage: { enabled: false } }),
);
mkdirSync(join(root, "src"));
const id = worktreeIdFor(root);
const main = openStore(commonDir);
assert(!("reason" in main));
const code = openCodeStore(commonDir, policy);
assert(!isCodeStoreOpenFailure(code));
main.worktrees.upsert({
  id,
  root,
  commonDir,
  isMain: true,
  registeredAt: Date.now(),
  daemon: null,
});
let revision = 1;
let listed = 1;
const entries = new Map<string, SourceFile>();
const revisions: string[][] = [["src/empty.ts"], ["src/new.ts"]];
function write(path: string, text: string) {
  writeFileSync(join(root, path), text);
  entries.set(path, {
    path,
    hash: blobHash(Buffer.from(text), "sha1"),
    size: Buffer.byteLength(text),
  });
}
const source: PassSource = {
  latestRevision: () => revision,
  changedPaths: (after, upTo) => revisions.slice(after, upTo).flat(),
  lastChanges: (after, upTo) =>
    new Map(
      revisions
        .slice(after, upTo)
        .flatMap((paths, index) => paths.map((path) => [path, after + index + 1])),
    ),
  movedHead: () => null,
  file: (path) => entries.get(path) ?? null,
  files: () => [...entries.values()],
  listing: () => ({ revision: listed, count: 0 }),
  testFiles: () => [],
  ignored: () => [],
};
const pass = () =>
  runPass({
    worktreeId: id,
    root,
    format: "sha1",
    store: code,
    source,
    counter: treeSitterCounter,
    complexity: policy.complexity,
    switchedOn: false,
    retry: new Set(),
    now: Date.now,
    log: () => {},
  });
function command(path: string, json = false) {
  const args = [
    "--disable-warning=ExperimentalWarning",
    cli,
    "code",
    path,
    ...(json ? ["--json"] : []),
  ];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return json ? JSON.parse(result.stdout) : result.stdout;
}
function snapshot(label: string, path: string) {
  const files = code.files.list(id, [path]);
  const row = files[0];
  const count = row ? code.counts.get(row.blob, row.language, row.counterVersion) : null;
  const report = command(path, true);
  console.log(
    JSON.stringify({
      label,
      revision,
      listed,
      path,
      indexed: files.length,
      storedCount:
        count === null ? null : { functions: count.functions.length, errors: count.errors.length },
      text: command(path),
      report,
    }),
  );
  return report;
}
try {
  console.log(
    JSON.stringify({
      cliVersion: execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(),
    }),
  );
  write("src/empty.ts", "export const answer = 42;\n");
  await pass();
  const empty = snapshot("counted empty control", "src/empty.ts");
  revision = 2;
  write(
    "src/new.ts",
    "export function hook(flag: boolean) {\n  const memo = () => flag ? 1 : 0;\n  return () => memo();\n}\n",
  );
  const before = snapshot("before pass", "src/new.ts");
  await pass();
  const held = snapshot("held for listing", "src/new.ts");
  assert.deepEqual(before.functions, empty.functions);
  assert.deepEqual(before.files, empty.files);
  assert.deepEqual(held.files, []);
  assert.equal(code.files.list(id, ["src/new.ts"]).length, 0);
  const bytes = readFileSync(join(root, "src/new.ts"), "utf8");
  listed = 2;
  await pass();
  const counted = snapshot("listing caught up, same bytes", "src/new.ts");
  assert.equal(counted.functions.length, 3);
  assert.equal(readFileSync(join(root, "src/new.ts"), "utf8"), bytes);
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", "src/new.ts"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(untracked, "src/new.ts");
  console.log(JSON.stringify({ untrackedAfterCount: untracked }));
  write("src/new.ts", `${bytes}\nexport function extra() {}\n`);
  const edited = snapshot("counted file edited without pass", "src/new.ts");
  assert.equal(edited.files[0].reason, "pending");
  // A files row with no count is distinct from no files row at all.
  const newRow = code.files.list(id, ["src/empty.ts"])[0];
  write("src/no-count.ts", "export const answer = 42;\n");
  code.files.upsertMany(id, [{ ...newRow, path: "src/no-count.ts", counterVersion: 999 }]);
  assert.equal(
    snapshot("index row, missing count control", "src/no-count.ts").files[0].reason,
    "not-counted",
  );
  console.log(
    JSON.stringify({ assertions: "passed", daemonStarted: false, testRunnerStarted: false }),
  );
} finally {
  code.close();
  main.close();
  rmSync(root, { recursive: true, force: true });
}
