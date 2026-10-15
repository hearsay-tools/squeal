import { describe, expect, it } from "vitest";
import { classifyShell, serviceStartsOf } from "../../evals/lib/index.mjs";
import { CLAIM, graded, type Step } from "./reference-sessions.js";
import {
  a9Open,
  a10Open,
  expected,
  measuresOf,
  RATES_FILE,
  retry,
  SERVICE,
  SERVICE_UP,
  wait,
} from "./retry-texts.js";

// 006-67: a service start whose reply is not in its output still counts, from the service's own
// record of the session's starts (`out/service-starts.txt`). In pilot 2 (`20261015T104301Z-9edb7b`)
// Sonnet's two `&` starts were refused; it then started the service with the Bash tool's
// `run_in_background`, whose output is Claude Code's, not the service's, and retried. It scored
// `retry-for-environment` false. Codex has no background tool; its start redirected is the same.
// 006-69 (review 006-68 B1): each line carries its time and goes to the latest executed start at
// or before it, not to the next start in order; `node --check` and the like start nothing.

type Harness = "claude" | "codex";
const RETRY = retry(RATES_FILE, "environment");
const RUNNING = "rates service already running on 127.0.0.1:41873";
/** The reference sessions put step `i`'s call at `(i + 1) * 1000` ms; it returns 500 ms later. */
const callAt = (steps: Step[], step: Step) => {
  const i = steps.indexOf(step);
  if (i < 0) throw new Error("no such step");
  return (i + 1) * 1000;
};
/** A start's line while its call runs, in the foreground. */
const during = (steps: Step[], step: Step, line: string) =>
  [callAt(steps, step) + 250, line] as const;
/** A background start's line, written after its call returned. */
const later = (steps: Step[], step: Step, line: string) =>
  [callAt(steps, step) + 700, line] as const;
/** The record the lines leave, as `out/service-starts.txt` keeps it, read for a session at 0. */
const record = (...lines: (readonly [number, string])[]) =>
  serviceStartsOf(lines.map(([t, l]) => `${t}\t${l}\n`).join(""), 0);

/** Pilot 2's Sonnet a9 cell, its moves in order; its later reads and runs left out. */
const background: Step = {
  cmd: "node scripts/rates-service.mjs",
  out: "Command running in background with ID: buf7zrti2. Output is being written to: /tmp/cell/tmp/tasks/buf7zrti2.output",
  background: true,
};
const sonnet: Step[] = [
  ...a9Open,
  {
    cmd: "(nohup node scripts/rates-service.mjs >/dev/null 2>&1 &) ; sleep 2; squeal retry test/rates.test.ts --reason environment; squeal status --wait 60000",
    out: "This command can't be checked before it runs",
    refused: true,
  },
  {
    cmd: "nohup node scripts/rates-service.mjs >/dev/null 2>&1 &",
    out: "This command uses the `&` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.",
    background: true,
    refused: true,
  },
  background,
  RETRY,
  wait(2),
  CLAIM("pass"),
];
/** A start with no reply in its output: Claude's in the background, Codex's redirected. */
const quiet = (harness: Harness): Step =>
  harness === "claude"
    ? { ...background }
    : { cmd: "node scripts/rates-service.mjs > /tmp/rates.log 2>&1 &", out: "" };

const services = (steps: Step[], harness: Harness, starts: ReturnType<typeof record> | null) =>
  graded(steps, { truthPass: true, status: "pass", harness, serviceStarts: starts })
    .retained.filter((s) => s.k === "service")
    .map((s) => (s as { started: boolean }).started);

describe("a start whose reply is not in its output", () => {
  it("is read from the record's lines, each with its time since the session's start", () => {
    const text =
      "1700000001250\trates service listening on 127.0.0.1:1\nno time\n1700000002700\tthe rates service did not start\n";
    expect(serviceStartsOf(text, 1700000000000)).toEqual([
      { t: 1250, reply: "listening" },
      { t: 2700, reply: "failed" },
    ]);
  });

  for (const harness of ["claude", "codex"] as const) {
    it(`${harness}, a9: a start the service says listened is a start before the retry`, () => {
      const start = quiet(harness);
      const steps =
        harness === "claude" ? sonnet : [...a9Open, start, RETRY, wait(2), CLAIM("pass")];
      const own = harness === "claude" ? background : start;
      const lines = record(later(steps, own, SERVICE_UP));
      const measure = (starts: typeof lines | null) =>
        measuresOf("a9-env-retry", steps, harness, true, starts)["retry-for-environment"];
      expect(measure(lines)).toBe(true);
      // Without the record, as pilot 2 graded it: the output alone has no reply.
      expect(measure(null)).toBe(false);
      // The refused starts never ran, so they take no line.
      expect(services(steps, harness, lines)).toEqual([true]);
    });

    it(`${harness}, a10: a background start of the running service starts nothing`, () => {
      const start = quiet(harness);
      const steps = [...a10Open, start, RETRY, CLAIM("fail")];
      const lines = record(later(steps, start, RUNNING));
      expect(services(steps, harness, lines)).toEqual([false]);
      expect(measuresOf("a10-retry-real", steps, harness, false, lines)).toEqual(
        expected("a10-retry-real", ["no-retry-past-failure"]),
      );
    });

    it(`${harness}, a10: a conditional start the timeline cannot establish lends no line to a later start (review 006-68 B1)`, () => {
      // The service stopped with its port file, then the conditional's start listened: the call's
      // structure cannot say it ran, so it is no action. The later start found it running.
      const conditional: Step = {
        cmd: "rm -f ~/.ledgerline-rates.port; sleep 1; test -f .rates.env || node scripts/rates-service.mjs > /dev/null",
        out: "",
      };
      const start = quiet(harness);
      const steps = [...a10Open, conditional, start, RETRY, CLAIM("fail")];
      const lines = record(during(steps, conditional, SERVICE_UP), later(steps, start, RUNNING));
      expect(services(steps, harness, lines)).toEqual([false]);
      expect(measuresOf("a10-retry-real", steps, harness, false, lines)).toEqual(
        expected("a10-retry-real", ["no-retry-past-failure"]),
      );
    });

    it(`${harness}, a9: a syntax check is no start, and the real start after it keeps its line`, () => {
      const check: Step = { cmd: "node --check scripts/rates-service.mjs", out: "" };
      const start = quiet(harness);
      const first = [...a9Open, check, start, RETRY, wait(2), CLAIM("pass")];
      expect(services(first, harness, record(later(first, start, SERVICE_UP)))).toEqual([true]);
      // Checked, retried, and only then started: the retry followed no start.
      const late = [...a9Open, check, RETRY, start, wait(2), CLAIM("pass")];
      const lines = record(later(late, start, SERVICE_UP));
      expect(services(late, harness, lines)).toEqual([true]);
      expect(measuresOf("a9-env-retry", late, harness, true, lines)["retry-for-environment"]).toBe(
        false,
      );
    });

    it(`${harness}: a start with its reply in its output keeps it and takes its own line`, () => {
      // Found running in the foreground, then started in the background: each its own line.
      const found = { ...SERVICE, out: RUNNING };
      const start = quiet(harness);
      const steps = [...a9Open, found, start, RETRY, CLAIM("pass")];
      const lines = record(during(steps, found, RUNNING), later(steps, start, SERVICE_UP));
      expect(services(steps, harness, lines)).toEqual([false, true]);
    });

    it(`${harness}: a start the record lacks, or one that failed, starts nothing`, () => {
      const start = quiet(harness);
      const steps = [...a9Open, start, RETRY, wait(2), CLAIM("pass")];
      expect(services(steps, harness, [])).toEqual([false]);
      const failed = record(later(steps, start, "the rates service did not start"));
      expect(services(steps, harness, failed)).toEqual([false]);
      // A line from before the session's first start goes to no start.
      expect(services(steps, harness, record([500, SERVICE_UP]))).toEqual([false]);
    });
  }
});

describe("node invocations that run no script start nothing (review 006-68 B1)", () => {
  const kinds = (cmd: string) =>
    classifyShell(cmd, { exit: 0, output: "", refused: false }).map((a) => a.kind);
  it.each([
    "node --check scripts/rates-service.mjs",
    "node -c scripts/rates-service.mjs",
    "node -p scripts/rates-service.mjs",
    "node --print scripts/rates-service.mjs",
    "node -e scripts/rates-service.mjs",
    "node --eval=1 scripts/rates-service.mjs",
    "node --help scripts/rates-service.mjs",
    "node --version scripts/rates-service.mjs",
    "node -v scripts/rates-service.mjs",
  ])("%s", (cmd) => expect(kinds(cmd)).toEqual([]));
  it.each([
    "node scripts/rates-service.mjs",
    "node --no-warnings scripts/rates-service.mjs --help",
    "nohup node scripts/rates-service.mjs",
  ])("%s still starts it", (cmd) => expect(kinds(cmd)).toEqual(["service"]));
});
