// Review 0.1.358 B1 repair: payload size, test-process CPU and map time per node:test file under
// tsx, old recorder (variable deleted at --require, mapper reads each source from disk) against the
// repaired one (deleted at the entry, tsx keeps the text in its maps). Usage:
//   git show <pre-repair>:src/runners/node-test/runtime/recorder.cjs > /tmp/recorder.old.cjs
//   npx tsx r1-blob-cost.mts "$PWD" /tmp/recorder.old.cjs 200 6   (from the repository root)
// The fixture goes under the git-ignored test/fixtures/node-test/.tmp/, so tsx resolves; it is removed.
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

type Row = { variant: string; bytes: number; cpu: number; wall: number; mapMs: number; sources: number; unread: number; load: number };
const rows: Row[] = [];
for (let round = 0; round < rounds; round++) {
  for (const variant of round % 2 === 0 ? ["old", "new"] : ["new", "old"]) {
    const dir = join(root, `cov-${round}-${variant}`);
    mkdirSync(dir);
    const load = loadavg()[0] ?? 0;
    const recorder = variant === "old" ? oldRecorder : newRecorder;
    const args = ["-f", "%e %U %S", process.execPath, "--enable-source-maps", "--require", recorder, "--import", "tsx", "--test", "test/all.test.ts"];
    const ran = spawnSync("/usr/bin/time", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_V8_COVERAGE: dir, SQUEAL_NODE_TEST_COVERAGE: dir, SQUEAL_NODE_TEST_GRAPH: join(dir, "graph") },
    });
    if (ran.status !== 0) throw new Error(`${variant}: ${ran.stderr}`);
    const [wall, user, sys] = (ran.stderr.trim().split("\n").at(-1) ?? "").split(" ").map(Number) as [number, number, number];
    const names = readdirSync(dir);
    const pid = names.flatMap((n) => /^own-(\d+)$/.exec(n)?.[1] ?? [])[0];
    const main = names.find((n) => new RegExp(`^coverage-${pid}-\\d+-0\\.json$`).test(n));
    if (main === undefined) throw new Error(`${variant}: no main-thread file in ${names.join(",")}`);
    const file = join(dir, main);
    const started = performance.now();
    const payload = JSON.parse(readFileSync(file, "utf8"));
    if (variant === "old") {
      // The old mapper read each own source from disk and used it as the map's text.
      for (const [url, entry] of Object.entries(payload["source-map-cache"] ?? {}) as [string, { data: { sourcesContent?: unknown[] } | null }][]) {
        if (url.startsWith(`file://${root}/`) && entry.data !== null) {
          entry.data.sourcesContent = [readFileSync(fileURLToPath(url), "utf8")];
        }
      }
    }
    const record = ownRecord(root, payload, "sha1");
    const mapMs = performance.now() - started;
    rows.push({ variant, bytes: statSync(file).size, cpu: user + sys, wall, mapMs, sources: record.sources.length, unread: record.unread.length, load });
  }
}
rmSync(root, { recursive: true, force: true });

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};
console.log(`node ${process.version}, ${modules} modules, ${rounds} rounds, tsx ${execFileSync(process.execPath, ["-p", `require(${JSON.stringify(join(repo, "node_modules/tsx/package.json"))}).version`], { encoding: "utf8" }).trim()}`);
for (const r of rows) console.log(JSON.stringify(r));
for (const variant of ["old", "new"]) {
  const of = rows.filter((r) => r.variant === variant);
  console.log(
    `${variant}: payload ${median(of.map((r) => r.bytes))} B, cpu ${median(of.map((r) => r.cpu)).toFixed(2)} s, wall ${median(of.map((r) => r.wall)).toFixed(2)} s, map ${median(of.map((r) => r.mapMs)).toFixed(1)} ms, sources ${median(of.map((r) => r.sources))}, unread ${median(of.map((r) => r.unread))}, load ${Math.min(...of.map((r) => r.load)).toFixed(1)}-${Math.max(...of.map((r) => r.load)).toFixed(1)}`,
  );
}
