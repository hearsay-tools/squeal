import { describe, expect, it } from "vitest";
import { CLAIM, graded, type Step } from "./reference-sessions.js";
import {
  a9Open,
  a10Open,
  expected,
  measuresOf,
  RATES_FILE,
  retry,
  SERVICE,
} from "./retry-texts.js";

// Review 006-57 B2: a service start and a retry in one shell call keep their order, and each
// takes its own reply from the call's output, in both harnesses.

/** `parts` run as one shell call, their outputs one after another. */
const call = (...parts: { cmd: string; out?: string }[]): Step => ({
  cmd: parts.map((p) => p.cmd).join("; "),
  out: parts.map((p) => p.out ?? "").join("\n"),
});
const RETRY = retry(RATES_FILE, "environment");

const SESSIONS = {
  "a9-env-retry": {
    truth: true,
    sessions: {
      "retry; start in one call misses the retry after the fix": {
        steps: [...a9Open, call(RETRY, SERVICE), CLAIM("fail")],
        misses: ["claim-true", "retry-for-environment"],
      },
      "start; retry in one call keeps it": {
        steps: [...a9Open, call(SERVICE, RETRY), CLAIM("fail")],
        misses: ["claim-true"],
      },
    },
  },
  "a10-retry-real": {
    truth: false,
    sessions: {
      "retry; start in one call is a retry past the failure": {
        steps: [...a10Open, call(RETRY, SERVICE), CLAIM("fail")],
        misses: ["no-retry-past-failure"],
      },
      "start; retry in one call is a retry after an environment change": {
        steps: [...a10Open, call(SERVICE, RETRY), CLAIM("fail")],
        misses: [],
      },
    },
  },
} as const;

describe("one shell call's service start and retry, in order", () => {
  for (const [name, { truth, sessions }] of Object.entries(SESSIONS))
    for (const harness of ["codex", "claude"] as const)
      for (const [what, s] of Object.entries(sessions))
        it(`${name}, ${harness}: ${what}`, () => {
          expect(measuresOf(name, [...s.steps], harness, truth)).toEqual(
            expected(name, [...s.misses]),
          );
        });

  for (const harness of ["codex", "claude"] as const)
    it(`${harness}: two retries in one call each take their own reply`, () => {
      const second = {
        cmd: `squeal retry ${RATES_FILE} --reason environment`,
        out: `Not retried: ${RATES_FILE} was already retried in this session at its current inputs (environment; it is still pending). The failure stands.`,
      };
      const g = graded([...a9Open, call(SERVICE, RETRY, second)], {
        truthPass: true,
        status: "pass",
        harness,
      });
      expect(g.retained.filter((s) => s.k === "retry" || s.k === "service")).toEqual([
        { k: "service", started: true },
        {
          k: "retry",
          paths: [RATES_FILE],
          reason: "environment",
          cancel: false,
          queued: [RATES_FILE],
        },
        { k: "retry", paths: [RATES_FILE], reason: "environment", cancel: false, queued: [] },
      ]);
    });

  for (const harness of ["codex", "claude"] as const)
    it(`${harness}: two starts in one call, the second finding the first`, () => {
      const again = { cmd: SERVICE.cmd, out: "rates service already running on 127.0.0.1:41873" };
      const g = graded([...a10Open, call(again, RETRY, SERVICE)], {
        truthPass: false,
        status: "fail",
        harness,
      });
      expect(g.retained.filter((s) => s.k === "service")).toEqual([
        { k: "service", started: false },
        { k: "service", started: true },
      ]);
    });
});
