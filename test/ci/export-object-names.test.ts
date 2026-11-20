import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeBundle } from "../../src/core/store/transfer-bundle.js";
import { project, reporterPair, withoutNodeOptions } from "../runners/node-test/ci-record-kit.js";
import { ci, committed, scratchDir, VITEST } from "./fixture.js";

/*
 * Reviews 0.1.582 B1 and 0.1.582-r2 B2 (row 018-59): tracked files at the
 * root named like `Object.prototype` members, each the one declared input
 * of its own test file, through `ci record` and `ci export` with both
 * runners. A map keyed by path built by assignment loses `__proto__`, and
 * the endpoint rule (spec 018 D33) then certifies it: a wrong pass. Each
 * test expects its input to hold `GOOD`; the export is right when it holds
 * exactly the test files that pass at the commit's content.
 */

const SLOW = { timeout: 300_000 } as const;

/** Each name, and the slug of the test file that reads it. Not an object literal: `__proto__:` there sets the prototype. */
const ENTRIES: readonly (readonly [string, string])[] = [
  ["__proto__", "proto"],
  ["constructor", "constructor"],
  ["toString", "tostring"],
  ["hasOwnProperty", "hasown"],
];

type Read = "node" | "shell";
type Runner = "vitest" | "node-test";

interface Case {
  /** How each test reads its input. */
  readonly read: Read;
  /** Each input's content at the commit. */
  readonly committed: "GOOD" | "BAD";
  /** Content written into the recording checkout before `ci record`, kept to its end. */
  readonly before?: "GOOD";
  /** Shell lines around the run, inside the recorded command. */
  readonly around?: { readonly first: string; readonly last: string };
}

const all = ENTRIES.map(([name]) => `'${name}'`).join(" ");

const CASES: Readonly<Record<string, Case>> = {
  // Read-time evidence (D9) certifies each.
  "read by Node": { read: "node", committed: "GOOD" },
  // Nothing hooked reads them: the endpoint rule (D33) certifies each.
  "read by a shell only": { read: "shell", committed: "GOOD" },
  // Review 0.1.582 B1: the endpoint hash at both ends is not the commit's.
  "changed before the step": { read: "shell", committed: "BAD", before: "GOOD" },
  // Review 0.1.582-r2 B2: the Node read saw the changed content; it must not fall back to D33.
  "changed and restored by a shell during the step": {
    read: "node",
    committed: "BAD",
    around: {
      first: `for f in ${all}; do printf 'GOOD\\n' > "$f"; done`,
      last: `git checkout -q -- ${all}`,
    },
  },
};

const readOf = (read: Read, name: string) =>
  read === "node"
    ? `readFileSync(${JSON.stringify(name)}, "utf8").trim()`
    : `execSync(${JSON.stringify(`cat ${name}`)}).toString().trim()`;

const IMPORTS =
  'import { execSync } from "node:child_process";\nimport { readFileSync } from "node:fs";\n';

function vitestFiles(read: Read): Record<string, string> {
  const tests = ENTRIES.map(([name, slug]) => [
    `test/${slug}.test.ts`,
    `${IMPORTS}import { expect, it } from "vitest";\nit("reads", () => expect(${readOf(read, name)}).toBe("GOOD"));\n`,
  ]);
  return {
    "package.json": JSON.stringify({ name: "ci-object-names", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1 } });\n`,
    ".gitignore": "node_modules/\n",
    "squeal.config.json": JSON.stringify({
      inputs: Object.fromEntries(ENTRIES.map(([name, slug]) => [`test/${slug}.test.ts`, [name]])),
    }),
    ...Object.fromEntries(tests),
  };
}

function nodeTestFiles(read: Read): Record<string, string> {
  const tests = ENTRIES.map(([name, slug]) => [
    `test/${slug}.test.mjs`,
    `${IMPORTS}import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("reads", () => assert.equal(${readOf(read, name)}, "GOOD"));\n`,
  ]);
  return {
    "squeal.config.json": JSON.stringify({
      nodeTest: [{ name: "unit", include: ["test/*.test.mjs"] }],
      inputs: Object.fromEntries(ENTRIES.map(([name, slug]) => [`test/${slug}.test.mjs`, [name]])),
    }),
    ...Object.fromEntries(tests),
  };
}

const quote = (args: readonly string[]) => args.map((a) => `'${a}'`).join(" ");

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A committed repository for `runner` whose inputs hold `content`; its root and test files. */
function repository(runner: Runner, read: Read, content: string) {
  // Assignment would drop `__proto__` here too.
  const inputs = Object.fromEntries(ENTRIES.map(([name]) => [name, `${content}\n`]));
  if (runner === "node-test") {
    const root = project({ ...nodeTestFiles(read), ...inputs });
    const files = ENTRIES.map(([, slug]) => `test/${slug}.test.mjs`);
    return { root, files, run: quote([process.execPath, "--test", ...reporterPair(), ...files]) };
  }
  const dir = scratchDir("ci-object-names");
  dirs.push(dir);
  const root = committed(dir, { ...vitestFiles(read), ...inputs });
  return {
    root,
    files: ENTRIES.map(([, slug]) => `test/${slug}.test.ts`),
    run: `"$NODE" "$VITEST" run`,
  };
}

/** Records `c` with `runner`, restores the commit's content, exports there: the exported test files. */
async function exportedOf(runner: Runner, c: Case) {
  const { root, files, run } = repository(runner, c.read, c.committed);
  for (const [name] of ENTRIES)
    if (c.before !== undefined) writeFileSync(join(root, name), `${c.before}\n`);
  const wrap = join(root, "..", `wrap-${runner}.sh`);
  writeFileSync(
    wrap,
    [c.around?.first ?? ":", `${run}; s=$?`, c.around?.last ?? ":", "exit $s", ""].join("\n"),
  );
  const env = { ...withoutNodeOptions(), CI: "true", NODE: process.execPath, VITEST };
  const parts = join(root, "..", "parts");
  const recorded = await ci(["record", "--out", parts, "--", "sh", wrap], root, env);
  // The export's checkout: the commit's content, as a fresh clone holds it.
  execFileSync("git", ["checkout", "-q", "--", "."], { cwd: root });
  const target = join(root, "..", "results.json.gz");
  const exported = await ci(["export", "--parts", parts, "--out", target], root, env);
  const bundle = existsSync(target) ? decodeBundle(readFileSync(target)) : null;
  if (typeof bundle === "string") throw new Error(bundle);
  const paths = (bundle?.testFiles.map((file) => file.path) ?? []).sort();
  return { recorded, exported, files, paths };
}

describe("ci record and ci export of inputs named like Object members (reviews 0.1.582 B1, r2 B2)", () => {
  const runners: readonly Runner[] = ["vitest", "node-test"];
  it.each(runners.flatMap((runner) => Object.keys(CASES).map((name) => [runner, name] as const)))(
    "%s, %s: exports exactly the test files that pass at the commit",
    SLOW,
    async (runner, name) => {
      const c = CASES[name] as Case;
      const { recorded, exported, files, paths } = await exportedOf(runner, c);
      expect(recorded.code, recorded.said).toBe(0);
      const passing = c.committed === "GOOD" ? [...files].sort() : [];
      expect(paths, exported.said).toEqual(passing);
    },
  );
});
