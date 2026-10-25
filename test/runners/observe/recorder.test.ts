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
        'import { readFileSync } from "node:fs";\nconst keys = Object.keys(process.env).filter((k) => !k.startsWith("SQUEAL") && k !== "NODE_OPTIONS" && k !== "NODE_V8_COVERAGE");\nprocess.stdout.write([process.env.ONLY, keys.join(","), readFileSync("data.txt", "utf8")].join(":"));\n',
      "other.mjs": 'import "./lib.mjs";\n',
      "lib.mjs": "export {};\n",
      "data.txt": "d",
      "listed/a.txt": "",
      "node_modules/pkg/index.js": "",
    });
    // `spawnSync(cmd, undefined, options)` kept its options (cwd, env); the child saw only ONLY
    // (Node adds NODE_V8_COVERAGE to every child's env, as c8 sets it: row 015-33)
    expect(JSON.parse(seen.stdout)).toEqual([0, "1:ONLY:d", ""]);
    expect(seen.paths).toEqual(
      expect.arrayContaining(["child.mjs", "data.txt", "lib.mjs", "main.mjs", "other.mjs"]),
    );
    expect(seen.paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(seen.paths.some((p) => p.startsWith(".observe"))).toBe(false);
    expect(seen.written).toEqual(["made", "out.txt"]);
    expect(seen.listed).toEqual(["listed"]);
  });

  it("records the directory each mkdtemp form creates, and reports it above what the run read below it", () => {
    const seen = observe({
      "main.mjs": [
        'import { execFileSync } from "node:child_process";',
        'import { mkdtemp, mkdtempSync, readFileSync } from "node:fs";',
        'import { mkdtemp as mkdtempPromise } from "node:fs/promises";',
        'const dirs = [mkdtempSync("tmp/s-")];',
        'dirs.push(await new Promise((resolve, reject) => mkdtemp("tmp/c-", (e, dir) => (e ? reject(e) : resolve(dir)))));',
        'dirs.push(await mkdtempPromise("tmp/p-"));',
        // `cp` writes outside the recorder: the run reads a file it did not write
        'for (const dir of dirs) execFileSync("cp", ["data.txt", dir + "/in.txt"]);',
        'process.stdout.write(dirs.map((dir) => readFileSync(dir + "/in.txt", "utf8")).join(""));',
        'readFileSync("data.txt", "utf8");',
      ].join("\n"),
      "tmp/.keep": "",
      "data.txt": "d",
    });
    expect(seen.stdout).toBe("ddd");
    expect(seen.written).toEqual([
      expect.stringMatching(/^tmp\/c-\w{6}$/),
      expect.stringMatching(/^tmp\/p-\w{6}$/),
      expect.stringMatching(/^tmp\/s-\w{6}$/),
    ]);
    const [inputs] = seen.inputs;
    expect(inputs?.paths).toEqual(
      expect.arrayContaining(["data.txt", ...seen.written.map((dir) => `${dir}/in.txt`)]),
    );
    // only the directories above a kept path: none above data.txt
    expect(inputs?.written).toEqual(seen.written);
  });

  it("reports no written directories for a run that wrote none above what it read", () => {
    const seen = observe({
      "main.mjs": [
        'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
        'mkdirSync("made");',
        'writeFileSync("made/out.txt", "o");',
        'readFileSync("data/in.txt", "utf8");',
      ].join("\n"),
      "data/in.txt": "i",
    });
    expect(seen.written).toEqual(["made", "made/out.txt"]);
    expect(seen.inputs[0]?.paths).toContain("data/in.txt");
    expect(seen.inputs[0]).not.toHaveProperty("written");
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

  it("records a script child's entry point and no argument of an -e or -p child (task 001-261)", () => {
    const code = 'require("node:fs").readFileSync("data.txt")';
    const evals = [
      ["-e", code],
      ["--eval", code],
      [`--eval=${code}`],
      ["-p", code],
      ["--print", code],
      ["-pe", code],
    ];
    const seen = observe({
      "main.mjs": [
        'import { execFileSync } from "node:child_process";',
        `for (const [i, flags] of ${JSON.stringify(evals)}.entries()) {`,
        '  execFileSync(process.execPath, [...flags, "arg" + i, "other"]);',
        "}",
        // no `.` or `/`: only the child's own entry point records it
        'execFileSync(process.execPath, ["script", "arg"]);',
      ].join("\n"),
      script: "",
      "data.txt": "d",
      ...Object.fromEntries(evals.map((_, i) => [`arg${i}`, ""])),
    });
    expect(seen.paths).toEqual(["data.txt", "main.mjs", "script"]);
  });

  it("gives a cezar-style `node -e <code> <json>` child one observed set in every worktree (task 001-261)", () => {
    const run = () =>
      observe({
        "main.mjs": [
          'import { execFileSync } from "node:child_process";',
          'const root = new URL(".", import.meta.url).pathname;',
          "const spec = JSON.stringify({ file: process.execPath, args: [root + 'gh.mjs', '--json'] });",
          "execFileSync(process.execPath, [\"-e\", \"require('node:fs').readFileSync('gh.mjs')\", spec]);",
        ].join("\n"),
        "gh.mjs": "",
      }).paths;
    const first = run();
    expect(first).toEqual(["gh.mjs", "main.mjs"]);
    expect(run()).toEqual(first);
  });

  it("records the worktree's .git entry and nothing under it (task 001-262)", () => {
    const seen = observe({
      "main.mjs": [
        'import { readFileSync, readdirSync, statSync } from "node:fs";',
        'statSync(".git");',
        'readFileSync(".git/HEAD");',
        'readdirSync(".git/refs");',
      ].join("\n"),
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/refs/heads/main": "",
    });
    expect(seen.paths).toEqual([".git", "main.mjs"]);
    expect(seen.listed).toEqual([]);
  });
});
