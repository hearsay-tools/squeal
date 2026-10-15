import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ATOMIC,
  CLAUDE_ALLOWED_TOOLS,
  cellEnv,
  classifyShell,
  retryEnv,
  SERVICE_FILES,
  scenarioOf,
} from "../../evals/lib/index.mjs";

// 006-62, finding 5: in the pilot's a9 Claude cells, Sonnet started the rates service as
// `LEDGERLINE_RATES_PORT_FILE=… node scripts/rates-service.mjs` and read the variable with
// `echo $LEDGERLINE_RATES_PORT_FILE`; Claude Code asked approval for both, so it never started
// the service. The service now needs no variable: its port file is in the cell's HOME, and the
// start the failure names is a bare `node` command the allow-list holds. Codex runs with full
// access; for both harnesses, the cell's environment names no port file.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Whether Claude Code's `Bash(<prefix>:*)` rules allow `command` without asking. */
const allowed = (command: string) =>
  CLAUDE_ALLOWED_TOOLS.some((rule) => {
    const prefix = /^Bash\((.*):\*\)$/.exec(rule)?.[1];
    return prefix !== undefined && (command === prefix || command.startsWith(`${prefix} `));
  });
const source = (f: string) => readFileSync(join(ATOMIC, "retry", f), "utf8");

describe("a9's service starts without a prompt", () => {
  it("is started as the failure says, a command the allow-list holds", () => {
    const start = /start it with: ([^`]+)`/.exec(source("src/rates.ts"))?.[1];
    expect(start).toBe("node scripts/rates-service.mjs");
    expect(allowed(start as string)).toBe(true);
    expect(classifyShell(start as string)).toEqual([{ kind: "service", execution: "executed" }]);
    // The pilot's form, which asked for approval.
    expect(allowed(`LEDGERLINE_RATES_PORT_FILE=/tmp/x/rates.port ${start}`)).toBe(false);
  });

  it("reads no environment variable in any file the scenario adds", () => {
    for (const f of SERVICE_FILES) expect(source(f), f).not.toMatch(/process\.env|LEDGERLINE_/);
  });

  for (const harness of ["claude", "codex"] as const)
    it(`${harness}: the cell's environment names no port file`, () => {
      const cell = mkdtempSync(join(tmpdir(), "squeal-service-start-"));
      dirs.push(cell);
      const env = cellEnv({ PATH: "/usr/bin", HOME: "/home/someone" }, cell);
      for (const name of ["a9-env-retry", "a10-retry-real"]) {
        retryEnv(scenarioOf(name)?.knobs ?? {}, cell, env);
        expect(
          Object.keys(env).filter((k) => k.startsWith("LEDGERLINE_")),
          harness,
        ).toEqual([]);
      }
      // The port file a start writes and a test reads: the cell's HOME, gone with the scratch.
      expect(env.HOME).toBe(join(cell, "home"));
    });
});
