import { createHash } from "node:crypto";
import type { Case, KeyInput } from "../../case.js";

/* 011-35's golden inputs (`research/probes/key-format-guard/golden.mjs`): keys over fixed inputs. */

const hash = (path: string) =>
  createHash("sha256").update(`content of ${path}`).digest("hex").slice(0, 40);
const paths = ["vitest.config.ts", "test/setup.ts", "src/a.ts", "src/b.ts", "test/a.test.ts"];

const input: KeyInput = {
  core: {
    squealVersion: "0.1.0",
    nodeVersion: "v24.21.0",
    platform: "linux",
    arch: "x64",
    installedDependencies: "deps-fingerprint",
    env: { CI: "1", NODE_ENV: "test" },
  },
  runner: {
    project: "app",
    runnerName: "vitest",
    runnerVersion: "3.2.4",
    adapterVersion: "3",
    resolvedConfig: '{"root":"."}',
    files: ["vitest.config.ts", "test/setup.ts"],
  },
  hashes: { ...Object.fromEntries(paths.map((p) => [p, hash(p)])), "src/missing.ts": null },
  testFile: { project: "app", path: "test/a.test.ts" },
  closure: ["src/a.ts", "src/b.ts", "src/missing.ts", "test/a.test.ts"],
};

export const GOLDEN_KEYS: readonly Case[] = [
  {
    kind: "key",
    name: "golden key",
    why: "011-35's golden key: an environment hash and a check key over a missing path",
    input,
  },
  {
    kind: "key",
    name: "golden key with a dependency segment",
    why: "011-35's golden key with a test file's installed-dependency segment (001-105)",
    input: { ...input, dependencies: "pkg@1.0.0" },
  },
];
