import { describe, expect, it } from "vitest";
import { observe, VITEST_STATE } from "./helpers.js";

// Review wave 12d, task 001-135: what the recorder must see, and what it must not change.
describe("observe recorder reach (review wave 12d)", { timeout: 60_000 }, () => {
  it("B2: a read through a file or directory symlink records the link and its in-scope target", () => {
    const seen = observe(
      {
        "main.mjs": [
          'import { existsSync, readFileSync, readdirSync } from "node:fs";',
          'readFileSync("alias.txt", "utf8");',
          'readFileSync("linked/inner.txt", "utf8");',
          'readdirSync("linked");',
          'existsSync("outside.txt");',
        ].join("\n"),
        "target.txt": "A",
        "real/inner.txt": "I",
      },
      "main.mjs",
      { links: { "alias.txt": "target.txt", linked: "real", "outside.txt": "../outside.txt" } },
    );
    expect(seen.paths).toEqual(
      expect.arrayContaining(["alias.txt", "target.txt", "linked/inner.txt", "real/inner.txt"]),
    );
    expect(seen.paths).toContain("outside.txt");
    expect(seen.listed).toEqual(["linked", "real"]);
    expect(seen.written).toEqual([]);
  });

  it("B3: readable opens are reads; only actual writes, truncation or creation are writes", () => {
    const seen = observe({
      "main.mjs": [
        'import { closeSync, constants, openSync, readFileSync, readSync, writeFileSync, writeSync } from "node:fs";',
        'import { open } from "node:fs/promises";',
        "const byte = (fd) => { const b = Buffer.alloc(1); readSync(fd, b, 0, 1, 0); closeSync(fd); return b.toString(); };",
        'const got = [byte(openSync("rplus.txt", "r+")), byte(openSync("rdwr.txt", constants.O_RDWR))];',
        'const handle = await open("handle.txt", "r+");',
        'got.push(await handle.readFile("utf8"));',
        "await handle.close();",
        'writeFileSync("out.txt", "o");',
        'got.push(readFileSync("out.txt", "utf8"));',
        'const rw = openSync("fdwrite.txt", "r+");',
        'writeSync(rw, "x");',
        "closeSync(rw);",
        'const hw = await open("handlewrite.txt", "r+");',
        'await hw.write("x");',
        "await hw.close();",
        'closeSync(openSync("created.txt", "a"));',
        'closeSync(openSync("appended.txt", "a"));',
        "process.stdout.write(got.join(''));",
      ].join("\n"),
      "rplus.txt": "A",
      "rdwr.txt": "B",
      "handle.txt": "C",
      "fdwrite.txt": "D",
      "handlewrite.txt": "E",
      "appended.txt": "F",
    });
    expect(seen.stdout).toBe("ABCo");
    expect(seen.paths).toEqual(expect.arrayContaining(["rplus.txt", "rdwr.txt", "handle.txt"]));
    expect(seen.written).toEqual(["created.txt", "fdwrite.txt", "handlewrite.txt", "out.txt"]);
  });

  it("B4: a SHARE_ENV Worker and its Node child are attributed though the env names no test file", () => {
    const seen = observe(
      {
        "main.mjs": [
          VITEST_STATE,
          'import { SHARE_ENV, Worker } from "node:worker_threads";',
          'const worker = new Worker(new URL("./shared.cjs", import.meta.url), { env: SHARE_ENV });',
          'const message = await new Promise((resolve) => worker.once("message", resolve));',
          "await worker.terminate();",
          "process.stdout.write(message);",
        ].join("\n"),
        "shared.cjs": [
          'const { execFileSync } = require("node:child_process");',
          'const { readFileSync } = require("node:fs");',
          'const { join } = require("node:path");',
          'const { parentPort } = require("node:worker_threads");',
          'const child = execFileSync(process.execPath, [join(__dirname, "descendant.cjs")], { encoding: "utf8" });',
          'parentPort.postMessage(readFileSync(join(__dirname, "shared.txt"), "utf8") + child);',
        ].join("\n"),
        "descendant.cjs":
          'process.stdout.write(require("node:fs").readFileSync(require("node:path").join(__dirname, "descendant.txt"), "utf8"));\n',
        "shared.txt": "S",
        "descendant.txt": "D",
      },
      "main.mjs",
      { viaVitest: true },
    );
    expect(seen.stdout).toBe("SD");
    expect(seen.paths).toEqual(
      expect.arrayContaining(["shared.cjs", "shared.txt", "descendant.cjs", "descendant.txt"]),
    );
  });

  it("B6: every sync spawn overload, valid or not, behaves as without the recorder", () => {
    const calls = [
      "spawnSync(node, ['-e', ''], 5)",
      "spawnSync(node, ['-e', ''], 'x')",
      "spawnSync(node, ['-e', ''], null)",
      "spawnSync(node, ['-e', ''], [1])",
      "spawnSync(node, 5)",
      "spawnSync(node, ['-e', print], { env: Object.create({ INHERITED: 'yes' }) })",
      "spawnSync(node, ['-e', print], { env: 'ab' })",
      "spawnSync(node, undefined, { input: print, env: { ONLY: '1' } })",
      "spawnSync(node, { input: print })",
      "execFileSync(node, ['-e', ''], 5)",
      "execFileSync(node, ['-e', ''], null)",
      "execFileSync(node, ['-e', print], { env: { __proto__: { INHERITED: 'yes' }, X: '1' } })",
      "execFileSync(node, 5)",
      "execFileSync(node, ['-e', ''], { env: {} }, 5)",
      "execSync(JSON.stringify(node) + ' -e \"\"', 5)",
      "execSync(JSON.stringify(node) + ' -e \"\"', [1])",
      "execSync(5)",
    ];
    const main = [
      'import { execFileSync, execSync, spawnSync } from "node:child_process";',
      "const node = process.execPath;",
      // the child's env, less what the recorder puts there
      'const print = \'process.stdout.write(Object.keys(process.env).filter((k) => !k.startsWith("SQUEAL") && k !== "NODE_OPTIONS").sort().join(","))\';',
      "const out = [];",
      ...calls.map(
        (call) =>
          `try { const r = ${call}; out.push(r?.error?.code ?? (typeof r?.status === "number" ? r.status + ":" + String(r.stdout) : String(r))); } catch (e) { out.push(e.code ?? e.message); }`,
      ),
      "process.stdout.write(JSON.stringify(out));",
    ].join("\n");
    const off = observe({ "main.mjs": main }, "main.mjs", { off: true });
    const on = observe({ "main.mjs": main });
    const results = JSON.parse(on.stdout);
    expect(Object.fromEntries(calls.map((c, i) => [c, results[i]]))).toEqual(
      Object.fromEntries(calls.map((c, i) => [c, JSON.parse(off.stdout)[i]])),
    );
  });

  it("B6: every Worker constructor form, valid or not, behaves as without the recorder", () => {
    const forms = [
      "{ eval: true, env: 5 }",
      "null",
      "5",
      "{ eval: true, env: Object.create({ INHERITED: 'yes' }) }",
      "{ eval: true, env: { __proto__: { INHERITED: 'yes' }, OWN: '1' } }",
      "{ eval: true, env: SHARE_ENV }",
      "{ eval: true }",
    ];
    const code =
      'require("node:worker_threads").parentPort.postMessage(Object.keys(process.env).filter((k) => !k.startsWith("SQUEAL") && k !== "NODE_OPTIONS").sort().join(","))';
    const main = [
      'import { SHARE_ENV, Worker } from "node:worker_threads";',
      `const code = ${JSON.stringify(code)};`,
      "const out = [];",
      ...forms.map(
        (form) =>
          `try { const w = new Worker(code, ${form}); out.push(await new Promise((r) => w.once("message", r).once("error", (e) => r(e.code ?? e.message)))); await w.terminate(); } catch (e) { out.push(e.code ?? e.constructor.name); }`,
      ),
      "process.stdout.write(JSON.stringify(out));",
    ].join("\n");
    const off = JSON.parse(observe({ "main.mjs": main }, "main.mjs", { off: true }).stdout);
    const on = JSON.parse(observe({ "main.mjs": main }).stdout);
    expect(Object.fromEntries(forms.map((f, i) => [f, on[i]]))).toEqual(
      Object.fromEntries(forms.map((f, i) => [f, off[i]])),
    );
  });
});
