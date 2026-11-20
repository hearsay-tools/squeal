import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeBundle } from "../../src/core/store/transfer-bundle.js";
import { ci, committed, scratchDir, VITEST } from "./fixture.js";

/*
 * Spec 018 D33, D34 (row 018-58): the six fixtures of
 * `research/unread-inputs.md` 1, each one test file recorded with `ci
 * record` through a shell wrapper and exported with `ci export` where the
 * wrapper left the content. The truth is plain Vitest at that content. A
 * test that reads `data/value.txt` reads it with `cat` in a shell string,
 * so no hooked process reads it and only the endpoint rule can certify
 * it; `data/**` is a declared input, as cezar declares its scripts.
 */

const SLOW = { timeout: 300_000 };

const BASE = {
  "package.json": JSON.stringify({ name: "ci-unread-fixture", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1 } });\n`,
  ".gitignore": "node_modules/\n",
  "squeal.config.json": JSON.stringify({ inputs: { "test/*.test.ts": ["data/**"] } }),
  "src/value.ts": 'export const value = "BAD";\n',
  "src/keep.ts": "export const other = 1;\n",
};

const IMPORTS = `import { expect, it } from "vitest";\nimport { value } from "../src/value.ts";\nit("value", () => expect(value).toBe("GOOD"));\n`;
const GENERATED = `import { expect, it } from "vitest";\nit("generated", async () => expect((await import("../src/generated.ts")).value).toBe("GOOD"));\n`;
const CAT = `import { execSync } from "node:child_process";\nimport { expect, it } from "vitest";\nit("data", () => expect(execSync("cat data/value.txt").toString().trim()).toBe("GOOD"));\n`;

/** `$NODE` and `$VITEST` are set by the record's command. */
const RUN = `"$NODE" "$VITEST" run; s=$?`;

/** Per mode: the committed `data/value.txt`, the test, and the wrapper the command runs. */
const MODES = {
  "shell-restore-import": {
    data: "GOOD",
    test: IMPORTS,
    wrap: `cp src/value.ts ../keep && printf 'export const value = "GOOD";\\n' > src/value.ts\n${RUN}\ncp ../keep src/value.ts; exit $s\n`,
  },
  "shell-generate-import": {
    data: "GOOD",
    test: GENERATED,
    wrap: `printf 'export const value = "GOOD";\\n' > src/generated.ts\n${RUN}\nrm src/generated.ts; exit $s\n`,
  },
  "node-restore-native-read": {
    data: "BAD",
    test: CAT,
    wrap: `"$NODE" -e 'require("fs").writeFileSync("data/value.txt", "GOOD\\n")'\n${RUN}\n"$NODE" -e 'require("fs").writeFileSync("data/value.txt", "BAD\\n")'; exit $s\n`,
  },
  "untouched-native-read": { data: "GOOD", test: CAT, wrap: `${RUN}\nexit $s\n` },
  "shell-restore-native-read": {
    data: "BAD",
    test: CAT,
    wrap: `printf 'GOOD\\n' > data/value.txt\n${RUN}\ngit checkout -q -- data/value.txt; exit $s\n`,
  },
  "today-node-read-first": {
    data: "BAD",
    test: CAT,
    wrap: `"$NODE" -e 'require("fs").readFileSync("data/value.txt")'\nprintf 'GOOD\\n' > data/value.txt\n${RUN}\ngit checkout -q -- data/value.txt; exit $s\n`,
  },
} as const;

const TEST = "test/a.test.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Records `mode`'s fixture through its wrapper, exports where it left the content, and runs plain Vitest there. */
async function fixture(mode: keyof typeof MODES) {
  const dir = scratchDir(`ci-unread-${mode}`);
  dirs.push(dir);
  const { data, test, wrap } = MODES[mode];
  const root = committed(dir, { ...BASE, "data/value.txt": `${data}\n`, [TEST]: test });
  writeFileSync(join(dir, "wrap.sh"), wrap);
  const out = join(dir, "parts");
  const env = { ...process.env, CI: "true", NODE: process.execPath, VITEST };
  const recorded = await ci(["record", "--out", out, "--", "sh", join(dir, "wrap.sh")], root, env);
  const target = join(dir, "results.json.gz");
  const exported = await ci(["export", "--parts", out, "--out", target], root);
  const bundle = existsSync(target) ? decodeBundle(readFileSync(target)) : null;
  if (typeof bundle === "string") throw new Error(bundle);
  const truth = spawnSync(process.execPath, [VITEST, "run"], {
    cwd: root,
    env: { ...process.env, CI: "true" },
  }).status;
  const paths = bundle?.testFiles.map((file) => file.path) ?? [];
  return { recorded, exported, exportedTest: paths.includes(TEST), truth };
}

describe("ci export of inputs nothing touched, the six fixtures (spec 018 D33, D34)", () => {
  it.each([
    ["shell-restore-import", "Vite's hooked read took the changed content"],
    ["shell-generate-import", "Vite's hooked read took the generated module"],
    ["node-restore-native-read", "a hooked process wrote the input"],
  ] as const)("%s: left out, %s", SLOW, async (mode, _why) => {
    const { recorded, exported, exportedTest, truth } = await fixture(mode);
    expect(recorded.code, recorded.said).toBe(0);
    expect(exportedTest, exported.said).toBe(false);
    expect(exported.said).toContain(`left out ${TEST}`);
    expect(truth).toBe(1);
  });

  it("untouched-native-read: exported, and correct", SLOW, async () => {
    const { recorded, exported, exportedTest, truth } = await fixture("untouched-native-read");
    expect(recorded.code, recorded.said).toBe(0);
    expect(exportedTest, exported.said).toBe(true);
    expect(exported.said).toContain(
      "1 of them rests on inputs that nothing in their shard's command",
    );
    expect(truth).toBe(0);
  });

  it(
    "shell-restore-native-read: exported though the test fails at that content, the residual D34 states",
    SLOW,
    async () => {
      // A shell changed data/value.txt, `cat` read it, `git checkout` restored it: no hooked
      // process saw either, and both endpoint hashes are the commit's. D8's condition (as
      // amended by D34) forbids such a command; the export cannot tell.
      const { recorded, exported, exportedTest, truth } = await fixture(
        "shell-restore-native-read",
      );
      expect(recorded.code, recorded.said).toBe(0);
      expect(exportedTest, exported.said).toBe(true);
      expect(truth).toBe(1);
    },
  );

  it(
    "today-node-read-first: exported by its read-time evidence, as before the rule",
    SLOW,
    async () => {
      const { recorded, exported, exportedTest, truth } = await fixture("today-node-read-first");
      expect(recorded.code, recorded.said).toBe(0);
      expect(exportedTest, exported.said).toBe(true);
      expect(truth).toBe(1);
    },
  );
});
