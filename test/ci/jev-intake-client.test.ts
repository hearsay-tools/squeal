import { describe, expect, it } from "vitest";
import { callJev, ENDPOINT } from "../../.github/scripts/jev-intake-client.cjs";
import { buildRequest } from "../../.github/scripts/jev-issue-intake.cjs";

const request = buildRequest({ issue: { title: "t", body: "b" }, candidates: [] });
const noSleep = async () => {};

function reply(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

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
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.Authorization).toBe(
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
