// Review 0.1.358 R2: what keeping NODE_V8_COVERAGE until the main script costs per node:test file
// under tsx, the R1 recorder (variable deleted where the preload phase ends) against the R2 one
// (deleted as `argv[1]` loads). Usage, from the repository root, with the Node to measure first on PATH:
//   git show <R1 build>:src/runners/node-test/runtime/recorder.cjs > /tmp/recorder.r1.cjs
//   npx tsx r2-entry-cost.mts "$PWD" /tmp/recorder.r1.cjs 200 6
// Runs each file as Squeal does, `node --test` with the recorder first, so the runner's child is the
// test file's process. The fixture goes under the git-ignored test/fixtures/node-test/.tmp/; it is removed.
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";

const [repo, oldRecorder, modulesArg, roundsArg] = process.argv.slice(2) as [string, string, string, string];
const { ownRecord } = await import(join(repo, "src/core/code/coverage/own.ts"));
const newRecorder = join(repo, "src/runners/node-test/runtime/recorder.cjs");
const modules = Number(modulesArg);
const rounds = Number(roundsArg);

const root = join(repo, "test/fixtures/node-test/.tmp", `bench-${randomUUID()}`);
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(root, "test"), { recursive: true });
writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
for (let i = 0; i < modules; i++) {
  writeFileSync(
    join(root, "src", `m${i}.ts`),
    `export function f${i}(x: number): number {\n  if (x > ${i}) {\n    return x - ${i};\n  }\n  return x + ${i};\n}\n`,
  );
}
const imports = Array.from({ length: modules }, (_, i) => `import { f${i} } from "../src/m${i}.ts";`);
const calls = Array.from({ length: modules }, (_, i) => `f${i}(${i % 3})`).join(" + ");
writeFileSync(
  join(root, "test", "all.test.ts"),
  `${imports.join("\n")}\nimport { test } from "node:test";\ntest("all", () => { ${calls}; });\n`,
);

type Row = { variant: string; cpu: number; wall: number; files: number; written: number; payload: number; sources: number; unread: number; load: number };
const rows: Row[] = [];
for (let round = 0; round < rounds; round++) {
  for (const variant of round % 2 === 0 ? ["r1", "r2"] : ["r2", "r1"]) {
    const dir = join(root, `cov-${round}-${variant}`);
    mkdirSync(dir);
    const load = loadavg()[0] ?? 0;
    const recorder = variant === "r1" ? oldRecorder : newRecorder;
    const args = ["-f", "%e %U %S", process.execPath, "--enable-source-maps", "--require", recorder, "--import", "tsx", "--test", "test/all.test.ts"];
    const ran = spawnSync("/usr/bin/time", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_V8_COVERAGE: dir, SQUEAL_NODE_TEST_COVERAGE: dir, SQUEAL_NODE_TEST_GRAPH: join(dir, "graph") },
    });
    if (ran.status !== 0) throw new Error(`${variant}: ${ran.stderr}`);
    const [wall, user, sys] = (ran.stderr.trim().split("\n").at(-1) ?? "").split(" ").map(Number) as [number, number, number];
    const names = readdirSync(dir).filter((n) => n.startsWith("coverage-"));
    const pid = readdirSync(dir).flatMap((n) => /^own-(\d+)$/.exec(n)?.[1] ?? [])[0];
    const main = names.find((n) => new RegExp(`^coverage-${pid}-\\d+-0\\.json$`).test(n));
    if (main === undefined) throw new Error(`${variant}: no main-thread file in ${names.join(",")}`);
    const record = ownRecord(root, JSON.parse(readFileSync(join(dir, main), "utf8")), "sha1");
    rows.push({
      variant,
      cpu: user + sys,
      wall,
      files: names.length,
      written: names.reduce((sum, n) => sum + statSync(join(dir, n)).size, 0),
      payload: statSync(join(dir, main)).size,
      sources: record.sources.length,
      unread: record.unread.length,
      load,
    });
  }
}
rmSync(root, { recursive: true, force: true });

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};
const tsx = execFileSync(process.execPath, ["-p", `require(${JSON.stringify(join(repo, "node_modules/tsx/package.json"))}).version`], { encoding: "utf8" }).trim();
console.log(`node ${process.version}, ${modules} modules, ${rounds} rounds, tsx ${tsx}, ${cpus().length} CPUs`);
for (const r of rows) console.log(JSON.stringify(r));
for (const variant of ["r1", "r2"]) {
  const of = rows.filter((r) => r.variant === variant);
  console.log(
    `${variant}: cpu ${median(of.map((r) => r.cpu)).toFixed(2)} s, wall ${median(of.map((r) => r.wall)).toFixed(2)} s, coverage files ${median(of.map((r) => r.files))}, written ${median(of.map((r) => r.written))} B, payload ${median(of.map((r) => r.payload))} B, sources ${median(of.map((r) => r.sources))}, unread ${median(of.map((r) => r.unread))}, load ${Math.min(...of.map((r) => r.load)).toFixed(1)}-${Math.max(...of.map((r) => r.load)).toFixed(1)}`,
  );
}
