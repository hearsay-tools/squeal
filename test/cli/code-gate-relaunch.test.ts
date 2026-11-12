import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { codeGateCommand } from "../../src/cli/code-gate.js";
import {
  REPORT_FD_VARIABLE,
  relaunchGate,
  type SignalSource,
  unframe,
} from "../../src/cli/code-gate-relaunch.js";
import type { CliIo } from "../../src/cli/main.js";
import { ownHomeAndTmp, repo } from "./code-gate-fixture.js";

/*
 * Spec 020 D14.4 (row 020-15b, #182): with `--json`, the CLI process runs
 * the gate in a child whose stdout is its stderr, and takes the report from
 * fd 3 as one frame, written once whole (D17.5). These children are small `node -e` scripts standing in
 * for the CLI; `code-gate-json-stdout.test.ts` runs the real one.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env[REPORT_FD_VARIABLE];
});

/** A child that writes `report` as one frame, then runs `then`. */
const framing = (report: string, then = "") =>
  `const b = Buffer.from(${JSON.stringify(report)}); require("fs").writeSync(3, Buffer.concat([Buffer.from(b.length + "\\n"), b])); ${then}`;

function capture(relaunch?: readonly string[]) {
  const out = { stdout: "", stderr: "" };
  const io: CliIo = {
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    cwd: tmpdir(),
    env: { PATH: process.env.PATH },
    ...(relaunch === undefined ? {} : { relaunch }),
  };
  return { io, out };
}

const node = (script: string) => [process.execPath, "-e", script];

describe("squeal code --base --json in a child of the CLI process (spec 020 D14.4, #182)", () => {
  it("runs `code <args>` in a marked child and gives its report and its exit code", async () => {
    const report = "process.argv.slice(1).join(' ') + ' ' + process.env.SQUEAL_CODE_GATE_REPORT_FD";
    const script = `const b = Buffer.from(${report}); require("fs").writeSync(3, Buffer.concat([Buffer.from(b.length + "\\n"), b])); process.exit(4)`;
    const { io, out } = capture(node(script));

    const code = await codeGateCommand(["--base", "main", "--json"], io);

    expect(out).toEqual({ stdout: "code --base main --json 3", stderr: "" });
    expect(code).toBe(4);
  });

  it("writes nothing to stdout and exits 3 when the child ends with no report", async () => {
    const { io, out } = capture(node("process.exit(0)"));

    expect(await codeGateCommand(["--base", "main", "--json"], io)).toBe(3);
    expect(out).toEqual({
      stdout: "",
      stderr:
        "squeal code: the gate's process ended with exit code 0 without a whole report, so stdout stays empty\n",
    });
  });

  it("writes nothing to stdout and exits 3 when the report is cut short", async () => {
    const { io, out } = capture(node('require("fs").writeSync(3, "50\\n{"); process.exit(0)'));

    expect(await codeGateCommand(["--base", "main", "--json"], io)).toBe(3);
    expect(out.stdout).toBe("");
    expect(unframe(Buffer.from("50\n{"))).toBeNull();
    expect(unframe(Buffer.from("2\n{}"))).toBe("{}");
  });

  it("writes the report once it is whole, while the child still runs (D17.5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-relaunch-"));
    dirs.push(dir);
    const printed = join(dir, "printed");
    // fd 3 stays open: the frame's length, not the pipe's end, says the report is whole.
    const wait = `const until = Date.now() + 10000; setInterval(() => { if (require("fs").existsSync(${JSON.stringify(printed)})) process.exit(0); if (Date.now() > until) process.exit(7); }, 20);`;
    const { io, out } = capture(node(framing("whole", wait)));
    const stdout = (text: string) => {
      io.stdout(text);
      writeFileSync(printed, "");
    };

    expect(await codeGateCommand(["--base", "main", "--json"], { ...io, stdout })).toBe(0);
    expect(out).toEqual({ stdout: "whole", stderr: "" });
  });

  it("keeps the report and exits 128 plus the signal when the child ends on one after it", async () => {
    const { io, out } = capture(node(framing("kept", 'process.kill(process.pid, "SIGTERM")')));

    expect(await codeGateCommand(["--base", "main", "--json"], io)).toBe(128 + 15);
    expect(out).toEqual({
      stdout: "kept",
      stderr: "squeal code: the gate's process ended on SIGTERM after its report\n",
    });
  });

  it("forwards SIGTERM to the child and exits with its code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-relaunch-"));
    dirs.push(dir);
    const ready = join(dir, "ready");
    const script = `process.on("SIGTERM", () => { ${framing("stopped", "process.exit(5)")} }); require("fs").writeFileSync(${JSON.stringify(ready)}, ""); setInterval(() => {}, 1000);`;
    const signals = new EventEmitter();
    const { io, out } = capture();

    const ran = relaunchGate(
      node(script),
      ["--base", "main", "--json"],
      io,
      signals as SignalSource,
    );
    while (!existsSync(ready)) await delay(20);
    signals.emit("SIGTERM");

    expect(await ran).toBe(5);
    expect(out.stdout).toBe("stopped");
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("never runs a child again in a marked process: its report goes to the marked descriptor", async () => {
    ownHomeAndTmp();
    const root = repo();
    const dir = mkdtempSync(join(tmpdir(), "squeal-relaunch-"));
    dirs.push(dir);
    const file = join(dir, "report");
    process.env[REPORT_FD_VARIABLE] = String(openSync(file, "w"));
    // The mark wins over `relaunch`: this command would exit 9.
    const { io, out } = capture(node("process.exit(9)"));

    const code = await codeGateCommand(["--base", "main", "--json"], { ...io, cwd: root });

    expect(code).toBe(0);
    expect(out.stdout).toBe("");
    expect(process.env[REPORT_FD_VARIABLE]).toBeUndefined();
    const report = JSON.parse(unframe(readFileSync(file)) ?? "") as { verdict: string };
    expect(report.verdict).toBe("pass");
  });

  it("runs in this process without --json", async () => {
    ownHomeAndTmp();
    const root = repo();
    const { io, out } = capture(node("process.exit(9)"));

    expect(await codeGateCommand(["--base", "main"], { ...io, cwd: root })).toBe(0);
    expect(out.stdout).toMatch(/^Code gate: pass\. No function changed against main/);
  });
});
