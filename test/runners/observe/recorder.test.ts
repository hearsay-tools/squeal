import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

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

  it("leaves a child with another Squeal's settings to that recorder", () => {
    const seen = observe({
      "main.mjs": [
        'import { execFileSync } from "node:child_process";',
        'import { mkdirSync, readdirSync, readFileSync } from "node:fs";',
        'const out = new URL("./inner", import.meta.url).pathname;',
        "mkdirSync(out);",
        'const root = new URL(".", import.meta.url).pathname.slice(0, -1);',
        'const inner = JSON.stringify({ out, root, file: root + "/inner.ts" });',
        'execFileSync(process.execPath, ["child.mjs"], { env: { ...process.env, SQUEAL_OBSERVE: inner } });',
        'const lines = readdirSync(out).map((f) => readFileSync(out + "/" + f, "utf8")).join("");',
        'process.stdout.write(String(lines.includes("data.txt")));',
      ].join("\n"),
      "child.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
      "data.txt": "d",
    });
    expect(seen.stdout).toBe("true");
    expect(seen.paths).not.toContain("data.txt");
  });

  it("records a listing with recursive: true as recursive in every form, and only those (task 001-139)", () => {
    const forms = ["sync", "callback", "promise", "module", "dirsync", "dircallback", "dirpromise"];
    const shallow = ["types", "encoding", "bare", "off"];
    const seen = observe({
      "main.mjs": [
        'import { opendir, opendirSync, promises, readdir, readdirSync } from "node:fs";',
        'import { readdir as readdirModule } from "node:fs/promises";',
        "const on = { recursive: true };",
        'const sync = readdirSync("sync", on);',
        'const callback = await new Promise((r) => readdir("callback", on, (e, names) => r(names)));',
        'const promise = await promises.readdir("promise", on);',
        'const module = await readdirModule("module", on);',
        'opendirSync("dirsync", on).closeSync();',
        'await new Promise((r) => opendir("dircallback", on, (e, dir) => dir.close(r)));',
        'await (await promises.opendir("dirpromise", on)).close();',
        'readdirSync("types", { withFileTypes: true });',
        'readdirSync("encoding", "utf8");',
        'await new Promise((r) => readdir("bare", r));',
        'await promises.readdir("off", { recursive: false });',
        "process.stdout.write(JSON.stringify([sync, callback, promise, module].map((n) => n.sort())));",
      ].join("\n"),
      ...Object.fromEntries([...forms, ...shallow].map((dir) => [`${dir}/sub/a.txt`, ""])),
    });
    // the caller's result is unchanged
    expect(JSON.parse(seen.stdout)).toEqual(forms.slice(0, 4).map(() => ["sub", "sub/a.txt"]));
    expect(seen.recursive).toEqual([...forms].sort());
    expect(seen.listed).toEqual(expect.arrayContaining([...forms, ...shallow]));
  });
});
