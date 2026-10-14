// Spec 009 Testing: a scripted fake model for real Pi 1.0.4, loaded with `-e`. It answers each
// model request with the next planned step and records every request it receives, so "did
// this text reach the next model request" is an assertion. No credentials, no network.
// From research/probes/pi-extension-events/probe.ts. Driven by `test/helpers/pi.ts`:
//   PI_FIXTURE_PLAN  a JSON file: an array of steps (`FakeStep` in the helper)
//   PI_FIXTURE_LOG   a JSONL file: one `{ n, systemPrompt, messages }` line per request
// A step's `release` holds its response until that file exists, so a test lands a result while
// the request is in flight, at a point it chose rather than inside a fixed delay.
import * as fs from "node:fs";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  type JsonObject,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

// Typed against Pi 1.0.4's exports. The file is outside tsconfig and Biome (Pi loads it with
// jiti); check it with
//   npx tsc --ignoreConfig --noEmit --strict --module nodenext --skipLibCheck --types node <file>

interface Step {
  text?: string;
  tools?: { name: string; arguments: JsonObject }[];
  delayMs?: number;
  waitAbort?: boolean;
  release?: string;
}

/** How long a `release` step waits for its file before it fails the request. */
const RELEASE_WAIT_MS = 120_000;

/**
 * Until `path` exists: `released`, `aborted` when Pi aborts the request first, `timeout` after
 * `RELEASE_WAIT_MS`. The poll and the abort listener go either way.
 */
function released(path: string, signal: AbortSignal | undefined) {
  return new Promise<"released" | "aborted" | "timeout">((resolve) => {
    const started = Date.now();
    const finish = (outcome: "released" | "aborted" | "timeout") => {
      clearInterval(poll);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish("aborted");
    const poll = setInterval(() => {
      if (fs.existsSync(path)) finish("released");
      else if (Date.now() - started > RELEASE_WAIT_MS) finish("timeout");
    }, 10);
    if (signal?.aborted) finish("aborted");
    else signal?.addEventListener("abort", onAbort);
  });
}

const LOG = process.env.PI_FIXTURE_LOG;
const PLAN: Step[] = process.env.PI_FIXTURE_PLAN
  ? JSON.parse(fs.readFileSync(process.env.PI_FIXTURE_PLAN, "utf8"))
  : [];

// Pi may load the factory again when an RPC session is replaced; the plan stays one sequence.
const g = globalThis as { __piFixtureRequests?: number };

const streamSimple: NonNullable<ProviderConfig["streamSimple"]> = (model, context, options) => {
  const stream = createAssistantMessageEventStream();
  const n = g.__piFixtureRequests ?? 0;
  g.__piFixtureRequests = n + 1;
  const step: Step = PLAN[n] ?? { text: `plan exhausted at request ${n}` };
  if (LOG) {
    const systemPrompt = getCurrentSystemPrompt(context.messages) ?? "";
    fs.appendFileSync(LOG, `${JSON.stringify({ n, systemPrompt, messages: context.messages })}\n`);
  }
  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };
    stream.push({ type: "start", partial: output });
    if (step.waitAbort) {
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) return resolve();
        options?.signal?.addEventListener("abort", () => resolve());
      });
      output.stopReason = "aborted";
      output.errorMessage = "Request was aborted";
      stream.push({ type: "error", reason: "aborted", error: output });
      stream.end();
      return;
    }
    if (step.release) {
      const outcome = await released(step.release, options?.signal);
      if (outcome !== "released") {
        output.stopReason = outcome === "aborted" ? "aborted" : "error";
        output.errorMessage =
          outcome === "aborted"
            ? "Request was aborted"
            : `fake provider: ${step.release} did not appear in ${RELEASE_WAIT_MS} ms`;
        stream.push({ type: "error", reason: output.stopReason, error: output });
        stream.end();
        return;
      }
    }
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
    if (step.text) {
      output.content.push({ type: "text", text: step.text });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: output });
    }
    for (const [i, call] of (step.tools ?? []).entries()) {
      const toolCall = { type: "toolCall" as const, id: `call_${n}_${i}`, ...call };
      output.content.push(toolCall);
      const contentIndex = output.content.length - 1;
      stream.push({ type: "toolcall_start", contentIndex, partial: output });
      stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
    }
    const reason = step.tools?.length ? "toolUse" : "stop";
    output.stopReason = reason;
    stream.push({ type: "done", reason, message: output });
    stream.end();
  })();
  return stream;
};

export default function (pi: ExtensionAPI) {
  pi.registerProvider("fake", {
    baseUrl: "http://fake.invalid",
    apiKey: "not-a-credential",
    api: "fake-api",
    models: [
      {
        id: "fake-1",
        name: "Fake 1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_000_000,
        maxTokens: 4096,
      },
    ],
    streamSimple,
  });
}
