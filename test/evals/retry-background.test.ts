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
// 006-72 (re-review 006-70 B1): with a record, the record alone says when the service came up:
// each `listening` line is a service step at its own time, paired with no command, and a start
// command adds no step. `node --check` and the like start nothing (006-69).

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
      expect(services(steps, harness, lines)).toEqual([]);
      expect(measuresOf("a10-retry-real", steps, harness, false, lines)).toEqual(
        expected("a10-retry-real", ["no-retry-past-failure"]),
      );
    });

    // Review 006-68 B1's three probes (round 1).
    it(`${harness}, a9: a syntax check, a retry, then a start: the retry followed no start`, () => {
      const check: Step = { cmd: "node --check scripts/rates-service.mjs", out: "" };
      const start = quiet(harness);
      const steps = [...a9Open, check, RETRY, start, wait(2), CLAIM("pass")];
      const lines = record(later(steps, start, SERVICE_UP));
      expect(services(steps, harness, lines)).toEqual([true]);
      expect(measuresOf("a9-env-retry", steps, harness, true, lines)["retry-for-environment"]).toBe(
        false,
      );
      // Checked, started, then retried: credited.
      const first = [...a9Open, check, start, RETRY, wait(2), CLAIM("pass")];
      const ok = record(later(first, start, SERVICE_UP));
      expect(measuresOf("a9-env-retry", first, harness, true, ok)["retry-for-environment"]).toBe(
        true,
      );
    });

    it(`${harness}, a10: a failed redirection, a retry, then a start: the retry is past the failure`, () => {
      const failed: Step = {
        cmd: "node scripts/rates-service.mjs > logs/rates.log 2>&1 &",
        out: "",
      };
      const start = quiet(harness);
      const steps = [...a10Open, failed, RETRY, start, CLAIM("fail")];
      const lines = record(later(steps, start, SERVICE_UP));
      expect(services(steps, harness, lines)).toEqual([true]);
      expect(measuresOf("a10-retry-real", steps, harness, false, lines)).toEqual(
        expected("a10-retry-real", ["no-retry-past-failure"]),
      );
    });

    it(`${harness}, a10: a restart before the failure, a no-op start after it: no change after the failure`, () => {
      const restart: Step = {
        cmd: "rm -f ~/.ledgerline-rates.port; sleep 1; if true; then node scripts/rates-service.mjs > /dev/null; fi",
        out: "",
      };
      const [registered, edit, failure] = a10Open as [Step, Step, Step];
      const start = quiet(harness);
      const steps = [registered, edit, restart, failure, start, RETRY, CLAIM("fail")];
      const lines = record(during(steps, restart, SERVICE_UP), later(steps, start, RUNNING));
      expect(services(steps, harness, lines)).toEqual([true]);
      expect(measuresOf("a10-retry-real", steps, harness, false, lines)).toEqual(
        expected("a10-retry-real", ["no-retry-past-failure"]),
      );
    });

    // Re-review 006-70 B1 (round 2).
    it(`${harness}, a9: a background start that listens only after the retry is no start before it`, () => {
      const start = quiet(harness);
      const steps = [...a9Open, start, RETRY, wait(2), CLAIM("pass")];
      // The retry was issued 1000 ms after the start; the service listened 300 ms later.
      const lines = record([callAt(steps, RETRY) + 300, SERVICE_UP]);
      expect(services(steps, harness, lines)).toEqual([true]);
      expect(measuresOf("a9-env-retry", steps, harness, true, lines)["retry-for-environment"]).toBe(
        false,
      );
    });

    it(`${harness}, a10: a delayed line during a later failed start is the service's, at its own time`, () => {
      // A background start before the failure; it listened while a later start, whose
      // redirection failed, ran after the failure. The failed start started nothing: the step is
      // the line's, after the failure was seen and before the retry (a listening line says the
      // script found no live service).
      const early = quiet(harness);
      const failed: Step = {
        cmd: "node scripts/rates-service.mjs > logs/rates.log 2>&1 &",
        out: "",
      };
      const [registered, edit, failure] = a10Open as [Step, Step, Step];
      const steps = [registered, edit, early, failure, failed, RETRY, CLAIM("fail")];
      const lines = record(during(steps, failed, SERVICE_UP));
      const g = graded(steps, { truthPass: false, status: "fail", harness, serviceStarts: lines });
      expect(g.retained.filter((s) => s.k === "service")).toEqual([
        { k: "service", started: true },
      ]);
      const order = g.retained.map((s) => s.k ?? "squeal");
      expect(order.lastIndexOf("squeal")).toBeLessThan(order.indexOf("service"));
      expect(order.indexOf("service")).toBeLessThan(order.indexOf("retry"));
      expect(measuresOf("a10-retry-real", steps, harness, false, lines)).toEqual(
        expected("a10-retry-real", []),
      );
    });

    it(`${harness}, a9: two starts in one call, the first listening, credit the retry after them`, () => {
      const both: Step = {
        cmd: "node scripts/rates-service.mjs > rates.log 2>&1; node scripts/rates-service.mjs",
        out: RUNNING,
      };
      const steps = [...a9Open, both, RETRY, wait(2), CLAIM("pass")];
      const lines = record(during(steps, both, SERVICE_UP), [callAt(steps, both) + 300, RUNNING]);
      expect(services(steps, harness, lines)).toEqual([true]);
      expect(measuresOf("a9-env-retry", steps, harness, true, lines)["retry-for-environment"]).toBe(
        true,
      );
    });

    it(`${harness}: with a record, a start's own output decides nothing`, () => {
      // Found running in the foreground, then started in the background: the record's listening.
      const found = { ...SERVICE, out: RUNNING };
      const start = quiet(harness);
      const steps = [...a9Open, found, start, RETRY, CLAIM("pass")];
      const lines = record(during(steps, found, RUNNING), later(steps, start, SERVICE_UP));
      expect(services(steps, harness, lines)).toEqual([true]);
      // A foreground start that printed listening, with a record that lacks it, started nothing.
      const own = [...a9Open, SERVICE, RETRY, CLAIM("pass")];
      expect(services(own, harness, [])).toEqual([]);
      // Without a record, as today: the output's reply.
      expect(services(own, harness, null)).toEqual([true]);
    });

    it(`${harness}: a record of failed or already-running starts adds no step`, () => {
      const start = quiet(harness);
      const steps = [...a9Open, start, RETRY, wait(2), CLAIM("pass")];
      expect(services(steps, harness, [])).toEqual([]);
      const lines = record(later(steps, start, "the rates service did not start"), [
        callAt(steps, RETRY) - 100,
        RUNNING,
      ]);
      expect(services(steps, harness, lines)).toEqual([]);
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
