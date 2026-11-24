// Throwaway probe for research 025-12 (D12): scratch CLI bundles, built with the shipped
// bundle's own esbuild options (`bundleOptions`, src/harness/build.ts). Run with tsx from a
// SCRATCH CLONE only: it writes `*.probe.ts` files into that clone's src/cli/.
//   tsx status-bundle.mts <outdir>
// Writes into <outdir> (a copy of plugins/claude-code/dist/cli, so sibling files resolve):
//   status.mjs        `main` with only `status` dispatched (no `status --at`): the candidate
//   status-at.mjs     the same with `status --at` kept
//   squeal-timed.mjs  the full `main`, with timing marks
//   status-timed.mjs  `status.mjs`, with timing marks
// The timing marks print one JSON line on stderr: `imported` (ms from process start to the
// entry's first line, after every module evaluated), `read0`/`read1` around `readStatus`,
// `out` before the stdout write, `done` after `main` returned. Prints each output's size and
// writes esbuild's metafile to <outdir>/meta.json.
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { build } from "esbuild";
import { bundleOptions, REPO_ROOT } from "../../../../../../src/harness/build.ts";

const outdir = process.argv[2];
if (outdir === undefined) throw new Error("usage: status-bundle.mts <outdir>");
const cli = join(REPO_ROOT, "src/cli");
const main = readFileSync(join(cli, "main.ts"), "utf8");

const mark = (text: string) =>
  text
    .replace(
      "  const result = readStatus(cwd, { now, busyRetryMs: CLI_READ_RETRY_MS, shell });",
      "  (globalThis as any).__read0 = performance.now();\n  const result = readStatus(cwd, { now, busyRetryMs: CLI_READ_RETRY_MS, shell });\n  (globalThis as any).__read1 = performance.now();",
    )
    .replace(
      "  io.stdout(parsed.json ? json(result) : human());",
      "  const text = parsed.json ? json(result) : human();\n  (globalThis as any).__out = performance.now();\n  io.stdout(text);",
    );
const statusOnly = (text: string, at: boolean) => {
  const start = text.indexOf("const COMMANDS: Readonly<Record<string, Command>> = {");
  const end = text.indexOf("\n};\n", start) + 4;
  const commands = at
    ? "const COMMANDS: Readonly<Record<string, Command>> = {\n  status: (args, io) => (asksAt(args) ? statusAt(args, io) : status(args, io)),\n};\n"
    : "const COMMANDS: Readonly<Record<string, Command>> = {\n  status: (args, io) => status(args, io),\n};\n";
  return text.slice(0, start) + commands + text.slice(end);
};
const marked = mark(main);
if (marked === main) throw new Error("timing marks did not apply: main.ts changed");
writeFileSync(join(cli, "main-full-timed.probe.ts"), marked);
writeFileSync(join(cli, "main-status.probe.ts"), statusOnly(main, false));
writeFileSync(join(cli, "main-status-at.probe.ts"), statusOnly(main, true));
writeFileSync(join(cli, "main-status-timed.probe.ts"), statusOnly(marked, false));

const index = readFileSync(join(cli, "index.ts"), "utf8");
const plain = (from: string) => index.replace('from "./main.js"', `from "./${from}.js"`);
const timed = (from: string) =>
  `${plain(from)
    .replace("#!/usr/bin/env node\n", "")
    .replace(
      'import { main } from',
      "const __imported = performance.now();\nimport { main } from",
    )}\nconst g = globalThis as any;\nprocess.stderr.write(\`\${JSON.stringify({ imported: __imported, read0: g.__read0, read1: g.__read1, out: g.__out, done: performance.now() })}\\n\`);\n`;
// `__imported` sits in the entry's own body, which a bundle runs after every module it imports.
writeFileSync(join(cli, "status-index.probe.ts"), plain("main-status.probe"));
writeFileSync(join(cli, "status-at-index.probe.ts"), plain("main-status-at.probe"));
writeFileSync(join(cli, "full-timed-index.probe.ts"), timed("main-full-timed.probe"));
writeFileSync(join(cli, "status-timed-index.probe.ts"), timed("main-status-timed.probe"));

const empty = mkdtempSync(join(tmpdir(), "no-hooks-"));
const base = bundleOptions(
  // `hookEntries` reads `entriesDir` relative to the repository root: an empty one, no hooks.
  { pluginDir: empty, entriesDir: relative(REPO_ROOT, empty), versionedFiles: [] },
  outdir,
);
mkdirSync(outdir, { recursive: true });
const entries = [
  { in: "src/cli/status-index.probe.ts", out: "status" },
  { in: "src/cli/status-at-index.probe.ts", out: "status-at" },
  { in: "src/cli/full-timed-index.probe.ts", out: "squeal-timed" },
  { in: "src/cli/status-timed-index.probe.ts", out: "status-timed" },
];
const { metafile } = await build({ ...base, entryPoints: entries, outdir: join(outdir, "cli") });
writeFileSync(join(outdir, "meta.json"), JSON.stringify(metafile));
for (const [file, out] of Object.entries(metafile?.outputs ?? {})) {
  console.log(JSON.stringify({ file, bytes: statSync(join(REPO_ROOT, file)).size, inputs: Object.keys(out.inputs).length }));
}
