import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { observeEnv, observeRecorder, takeRecorded } from "../../../src/runners/observe/index.js";

const recorder = observeRecorder(
  new URL("../../../src/runners/observe/runtime.ts", import.meta.url),
);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A worktree holding `files`, and a run of `main` under the recorder attributed to `test.ts`. */
function observe(files: Record<string, string>, main = "main.mjs") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-recorder-")));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const out = join(root, ".observe");
  mkdirSync(out);
  if (recorder === null) throw new Error("recorder.cjs not found");
  const env = observeEnv(recorder, { out, root, skip: [] }, undefined);
  const settings = JSON.parse(env.SQUEAL_OBSERVE ?? "{}");
  const stdout = execFileSync(process.execPath, [join(root, main)], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      NODE_OPTIONS: env.NODE_OPTIONS ?? "",
      SQUEAL_OBSERVE: JSON.stringify({ ...settings, file: join(root, "test.ts") }),
    },
  });
  const recorded = takeRecorded(out).get(join(root, "test.ts"));
  const rel = (set: Set<string> | undefined) =>
    [...(set ?? [])].map((p) => p.slice(root.length + 1)).sort();
  return {
    stdout,
    paths: rel(recorded?.paths),
    listed: rel(recorded?.listed),
    written: rel(recorded?.written),
  };
}

describe("observe recorder (task 001-132)", { timeout: 60_000 }, () => {
  it("keeps what twenty Workers read though each is terminated at its message", () => {
    const seen = observe({
      "main.mjs": [
        'import { Worker } from "node:worker_threads";',
        "for (let i = 0; i < 20; i++) {",
        "  const w = new Worker(new URL('./w' + i + '.mjs', import.meta.url));",
        '  await new Promise((r) => w.once("message", r));',
        "  await w.terminate();",
        "}",
      ].join("\n"),
      ...Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          `w${i}.mjs`,
          `import { readFileSync } from "node:fs";\nimport { parentPort } from "node:worker_threads";\nparentPort.postMessage(readFileSync(new URL("./d${i}.txt", import.meta.url), "utf8"));\n`,
        ]),
      ),
      ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`d${i}.txt`, "x"])),
    });
    for (let i = 0; i < 20; i++) expect(seen.paths).toContain(`d${i}.txt`);
  });

  it("reaches sync spawns with env {}, keeps the caller's options, and records writes and listings", () => {
    const seen = observe({
      "main.mjs": [
        'import { execFileSync, execSync, spawnSync } from "node:child_process";',
        'import { mkdirSync, readdirSync, writeFileSync } from "node:fs";',
        'const a = spawnSync(process.execPath, undefined, { input: "", env: {}, encoding: "utf8", cwd: "sub" });',
        'const b = execFileSync(process.execPath, ["child.mjs"], { env: { ONLY: "1" }, encoding: "utf8" });',
        'const c = execSync(JSON.stringify(process.execPath) + " other.mjs", { env: {}, encoding: "utf8" });',
        'writeFileSync("out.txt", "o");',
        'mkdirSync("made", { recursive: true });',
        'readdirSync("listed");',
        "process.stdout.write(JSON.stringify([a.status, b.trim(), c.trim()]));",
      ].join("\n"),
      "sub/.keep": "",
      "child.mjs":
        'import { readFileSync } from "node:fs";\nconst keys = Object.keys(process.env).filter((k) => !k.startsWith("SQUEAL") && k !== "NODE_OPTIONS");\nprocess.stdout.write([process.env.ONLY, keys.join(","), readFileSync("data.txt", "utf8")].join(":"));\n',
      "other.mjs": 'import "./lib.mjs";\n',
      "lib.mjs": "export {};\n",
      "data.txt": "d",
      "listed/a.txt": "",
      "node_modules/pkg/index.js": "",
    });
    // `spawnSync(cmd, undefined, options)` kept its options (cwd, env); the child saw only ONLY
    expect(JSON.parse(seen.stdout)).toEqual([0, "1:ONLY:d", ""]);
    expect(seen.paths).toEqual(
      expect.arrayContaining(["child.mjs", "data.txt", "lib.mjs", "main.mjs", "other.mjs"]),
    );
    expect(seen.paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(seen.paths.some((p) => p.startsWith(".observe"))).toBe(false);
    expect(seen.written).toEqual(["made", "out.txt"]);
    expect(seen.listed).toEqual(["listed"]);
  });
});
