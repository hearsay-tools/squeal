import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateIntake } from "../../.github/scripts/apply-issue-intake.cjs";
import type { Candidate } from "../../.github/scripts/issue-intake-candidates.cjs";
import {
  AREA_CRITERIA,
  buildRecheckRequest,
  buildRequest,
  callJev,
  ENDPOINT,
  excerptOf,
  type JevAnswer,
  main,
  mapAnswers,
  shortlist,
  THRESHOLDS,
  TYPE_CRITERIA,
  triage,
} from "../../.github/scripts/jev-issue-intake.cjs";

const issue = { number: 211, title: "Wait returns late", body: "The named wait blocks." };
const candidates: Candidate[] = [
  {
    number: 14,
    title: "Named waits select unrelated files",
    body: "x".repeat(1000),
    labels: [],
    updated_at: null,
    open: true,
  },
  { number: 5, title: "Release notes", body: "", labels: [], updated_at: null, open: false },
];
const request = buildRequest({ issue, candidates });
const noSleep = async () => {};

function choice(picked: string, p: number): JevAnswer {
  return { type: "choice", choice: picked, probabilities: { [picked]: p }, confidence: p };
}
function noul(p: number): JevAnswer {
  return { type: "noul", noul: p };
}
function response(overrides: Record<string, JevAnswer | undefined> = {}) {
  return {
    model: "jev-1.13.0",
    answers: {
      duplicate: choice("none", 0.97),
      main_area: choice("area-core", 0.8),
      type: choice("bug", 0.9),
      ...overrides,
    },
  };
}
function recheckFor(numbers: number[], overrides: Record<string, JevAnswer | undefined> = {}) {
  const recheckRequest = buildRecheckRequest({ issue, candidates, numbers });
  const answers: Record<string, JevAnswer | undefined> = { duplicate: choice("none", 0.9) };
  for (const number of numbers) answers[`same_work:#${number}`] = noul(0.1);
  return {
    request: recheckRequest,
    response: { model: "jev-1.13.0", answers: { ...answers, ...overrides } },
  };
}
function reply(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function scripted(bodies: unknown[]) {
  const calls: { questions: Record<string, { criteria?: object }> }[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return reply(200, bodies.shift());
  };
  return { calls, fetchImpl };
}

describe("buildRequest", () => {
  it("asks one duplicate choice over the candidates, open and closed, plus none", () => {
    expect(request.model).toBe("jev-1.13.0");
    expect(request.state).toEqual({ title: issue.title, body: issue.body });
    const duplicate = request.questions.duplicate;
    expect(duplicate?.type).toBe("choice");
    const criteria = duplicate?.type === "choice" ? duplicate.criteria : {};
    expect(Object.keys(criteria)).toEqual(["#14", "#5", "none"]);
    const excerpt = (criteria["#14"] as { excerpt: string }).excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(301);
    expect(excerpt.startsWith("xxx")).toBe(true);
  });

  it("asks the code-owned areas and the three types, whatever labels GitHub has", () => {
    expect(Object.keys(request.questions).sort()).toEqual(["duplicate", "main_area", "type"]);
    const area = request.questions.main_area;
    expect(area?.type === "choice" && area.criteria).toEqual(AREA_CRITERIA);
    expect(Object.keys(AREA_CRITERIA)).toEqual([
      "area-core",
      "area-slow-suites",
      "area-adoption",
      "area-harness",
      "area-runner",
      "area-evals",
      "area-ci",
      "none",
    ]);
    const type = request.questions.type;
    expect(type?.type === "choice" && Object.keys(type.criteria)).toEqual([
      "bug",
      "enhancement",
      "documentation",
      "none",
    ]);
  });

  it("names the owning spec in every area's description", () => {
    const specs: Record<string, string[]> = {
      "area-core": ["011"],
      "area-slow-suites": ["004"],
      "area-adoption": ["005"],
      "area-harness": ["002", "008", "009", "012"],
      "area-runner": ["003", "007", "013"],
      "area-evals": ["006"],
      "area-ci": ["010"],
    };
    for (const [area, numbers] of Object.entries(specs)) {
      for (const number of numbers) expect(AREA_CRITERIA[area], area).toContain(number);
    }
  });

  it("drops excerpts from a long candidate list to stay inside the context budget", () => {
    const many: Candidate[] = Array.from({ length: 254 }, (_, i) => ({
      number: i + 1,
      title: `Issue title number ${i + 1} `.repeat(4),
      body: "y".repeat(2000),
      labels: [],
      updated_at: null,
      open: true,
    }));
    const big = buildRequest({ issue: { ...issue, body: "z".repeat(50_000) }, candidates: many });
    const duplicate = big.questions.duplicate;
    const criteria = duplicate?.type === "choice" ? duplicate.criteria : {};
    expect(Object.keys(criteria)).toHaveLength(255);
    expect(big.state.body.length).toBeLessThanOrEqual(12_001);
    expect(JSON.stringify(big.state).length + JSON.stringify(criteria).length).toBeLessThanOrEqual(
      28_000 * 3,
    );
  });

  it("drops template headings and HTML comments from excerpts", () => {
    expect(
      excerptOf(
        "## Context / Why\n\nUnder load, git collides.\n<!-- note -->\n### What\nFix it.",
        300,
      ),
    ).toBe("Under load, git collides. Fix it.");
    expect(excerptOf("a".repeat(400), 300)).toHaveLength(301);
  });

  it("gives every type a code-owned description, none included", () => {
    const type = request.questions.type;
    expect(type?.type === "choice" && type.criteria).toEqual(TYPE_CRITERIA);
    expect(TYPE_CRITERIA.bug).toMatch(/flaky test/);
    expect(TYPE_CRITERIA.none).toMatch(/refactoring/);
  });
});

describe("the recheck", () => {
  it("re-reads the shortlisted candidates in full and can reject them all", () => {
    const recheck = buildRecheckRequest({ issue, candidates, numbers: [14, 5] });
    expect(Object.keys(recheck.questions).sort()).toEqual([
      "duplicate",
      "same_work:#14",
      "same_work:#5",
    ]);
    const duplicate = recheck.questions.duplicate;
    const criteria = duplicate?.type === "choice" ? duplicate.criteria : {};
    expect(Object.keys(criteria)).toEqual(["#14", "#5", "none"]);
    expect(criteria["#14"]).toEqual({ title: candidates[0]?.title, body: candidates[0]?.body });
    expect(duplicate?.instructions).toMatch(/follows up on, builds on, or was split out of/);
    expect(() => buildRecheckRequest({ issue, candidates, numbers: [211] })).toThrow(
      /not a duplicate candidate/,
    );
  });

  it("shortlists the top three once the best candidate reaches its threshold", () => {
    const ranked = (probabilities: Record<string, number>) => ({
      answers: { duplicate: { type: "choice", choice: "none", probabilities } },
    });
    const top = { none: 0.05, "#14": THRESHOLDS.shortlist, "#15": 0.02, "#16": 0.01, "#17": 0.005 };
    expect(shortlist({ response: ranked(top) })).toEqual([14, 15, 16]);
    expect(
      shortlist({ response: ranked({ none: 0.9, "#14": THRESHOLDS.shortlist - 0.01 }) }),
    ).toEqual([]);
  });
});

describe("mapAnswers", () => {
  it("picks a duplicate only when the recheck pick and its same-work answer reach their thresholds", () => {
    const close = recheckFor([14, 5], {
      duplicate: choice("#14", THRESHOLDS.duplicate),
      "same_work:#14": noul(THRESHOLDS.sameWork),
    });
    const at = mapAnswers({ request, response: response(), recheck: close });
    expect(at).toEqual({
      action: "duplicate",
      duplicate_of: 14,
      comment: `Jev probability ${THRESHOLDS.duplicate.toFixed(2)}, same work ${THRESHOLDS.sameWork.toFixed(2)}`,
      labels: ["area-core", "bug"],
    });
    validateIntake(at);

    const weak = recheckFor([14], {
      duplicate: choice("#14", THRESHOLDS.duplicate - 0.01),
      "same_work:#14": noul(0.99),
    });
    expect(mapAnswers({ request, response: response(), recheck: weak }).action).toBe("label");
    const other = recheckFor([14], {
      duplicate: choice("#14", 0.99),
      "same_work:#14": noul(THRESHOLDS.sameWork - 0.01),
    });
    expect(mapAnswers({ request, response: response(), recheck: other }).action).toBe("label");
    const rejected = recheckFor([14], {
      duplicate: choice("none", 0.99),
      "same_work:#14": noul(0.99),
    });
    expect(mapAnswers({ request, response: response(), recheck: rejected }).action).toBe("label");
  });

  it("never picks a duplicate from the first call alone, however sure it is", () => {
    const result = mapAnswers({ request, response: response({ duplicate: choice("#14", 1) }) });
    expect(result.action).toBe("label");
    expect(result.duplicate_of).toBeNull();
  });

  it("gives at most one area and one type, each at its threshold and not below", () => {
    const at = mapAnswers({
      request,
      response: response({
        main_area: choice("area-runner", THRESHOLDS.mainArea),
        type: choice("enhancement", THRESHOLDS.type),
      }),
    });
    expect(at.labels).toEqual(["area-runner", "enhancement"]);
    const below = mapAnswers({
      request,
      response: response({
        main_area: choice("area-runner", THRESHOLDS.mainArea - 0.01),
        type: choice("enhancement", THRESHOLDS.type - 0.01),
      }),
    });
    expect(below).toEqual({ action: "skip", duplicate_of: null, comment: null, labels: [] });
    const none = mapAnswers({
      request,
      response: response({ main_area: choice("none", 0.99), type: choice("none", 0.99) }),
    });
    expect(none.action).toBe("skip");
  });

  it("fails on a malformed answer instead of guessing", () => {
    expect(() => mapAnswers({ request, response: {} })).toThrow(/no answers/);
    expect(() =>
      mapAnswers({ request, response: response({ duplicate: choice("#211", 0.99) }) }),
    ).toThrow(/not offered/);
    expect(() =>
      mapAnswers({ request, response: response({ main_area: choice("area-web", 0.99) }) }),
    ).toThrow(/not offered/);
    expect(() =>
      mapAnswers({
        request,
        response: response(),
        recheck: recheckFor([14], { duplicate: choice("#5", 0.99) }),
      }),
    ).toThrow(/not offered/);
    expect(() =>
      mapAnswers({
        request,
        response: response(),
        recheck: recheckFor([14], { duplicate: choice("#14", 0.99), "same_work:#14": undefined }),
      }),
    ).toThrow(/missing/);
    expect(() => mapAnswers({ request, response: response({ type: noul(0.5) }) })).toThrow(
      /not a choice/,
    );
    expect(() => mapAnswers({ request, response: response({ type: choice("bug", 1.5) }) })).toThrow(
      /not a probability/,
    );
    expect(() => mapAnswers({ request, response: response({ main_area: undefined }) })).toThrow(
      /missing/,
    );
  });
});

describe("callJev", () => {
  it("posts the request with the key and retries rate limits and overload", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sleeps: number[] = [];
    const replies = [
      reply(429, {}, { "retry-after": "2" }),
      reply(529),
      reply(200, { answers: {} }),
    ];
    const result = await callJev({
      request,
      apiKey: "test-key",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return replies.shift();
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result).toEqual({ answers: {} });
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe(ENDPOINT);
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(request);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("fails closed on a client error, on exhausted retries and without a key", async () => {
    const fails = (fetchImpl: () => Promise<unknown>, maxAttempts = 4) =>
      callJev({ request, apiKey: "k", fetchImpl, sleep: noSleep, maxAttempts });
    await expect(fails(async () => reply(422, { detail: "bad question" }))).rejects.toThrow(
      /HTTP 422: .*bad question/,
    );
    await expect(fails(async () => reply(529), 2)).rejects.toThrow(/HTTP 529/);
    await expect(
      fails(async () => {
        throw new Error("socket hang up");
      }, 2),
    ).rejects.toThrow(/after 2 attempts: socket hang up/);
    await expect(
      callJev({ request, apiKey: "", fetchImpl: async () => reply(200) }),
    ).rejects.toThrow(/TYPESAFE_API_KEY/);
  });
});

describe("triage", () => {
  it("makes one call when no candidate ranks high, and a recheck call when one does", async () => {
    const quiet = scripted([response()]);
    const one = await triage({
      issue,
      candidates,
      apiKey: "k",
      fetchImpl: quiet.fetchImpl,
      sleep: noSleep,
    });
    expect(quiet.calls).toHaveLength(1);
    expect(one.intake.labels).toEqual(["area-core", "bug"]);
    expect(one.log).toMatch(/recheck: skipped/);

    const ranked = response({
      duplicate: {
        type: "choice",
        choice: "#14",
        probabilities: { "#14": 0.7, "#5": 0.2, none: 0.1 },
      },
    });
    const sure = {
      model: "jev-1.13.0",
      answers: {
        duplicate: choice("#14", 0.97),
        "same_work:#14": noul(0.95),
        "same_work:#5": noul(0.1),
      },
    };
    const loud = scripted([ranked, sure]);
    const two = await triage({
      issue,
      candidates,
      apiKey: "k",
      fetchImpl: loud.fetchImpl,
      sleep: noSleep,
    });
    expect(loud.calls).toHaveLength(2);
    expect(Object.keys(loud.calls[1]?.questions.duplicate?.criteria ?? {})).toEqual([
      "#14",
      "#5",
      "none",
    ]);
    expect(two.intake).toMatchObject({ action: "duplicate", duplicate_of: 14 });
    expect(two.log).toMatch(/recheck same_work:#14: 0\.95/);
  });

  it("reads issue.json and candidates.json and writes a valid intake.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-intake-"));
    try {
      writeFileSync(join(dir, "issue.json"), JSON.stringify(issue));
      writeFileSync(join(dir, "candidates.json"), JSON.stringify(candidates));
      const { fetchImpl } = scripted([response()]);
      const output = join(dir, "out", "intake.json");
      const log = console.log;
      console.log = () => {};
      try {
        await main([dir, output], { TYPESAFE_API_KEY: "k" }, { fetchImpl, sleep: noSleep });
      } finally {
        console.log = log;
      }
      const intake = JSON.parse(readFileSync(output, "utf8"));
      validateIntake(intake);
      expect(intake).toEqual({
        action: "label",
        duplicate_of: null,
        comment: null,
        labels: ["area-core", "bug"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
