// Spec 008 Testing: a scripted model for the real OpenCode 1.18.35. A local HTTP server speaking
// the OpenAI-compatible chat API (`POST /v1/chat/completions`, streamed as server-sent events),
// configured as a provider in the run's `opencode.json`. Each request to the planned model gets
// the next planned step; every request is recorded, so "did this text reach the next model
// request" is an assertion. No credentials, no network beyond 127.0.0.1.
//
// Imported by `test/helpers/opencode.ts`, or run on its own (the isolation check runs it as
// `squeal-e2e`, where Node strips the types):
//   node scripted-provider.ts <plan.json> <requests.jsonl> <url-file>
// It writes its base URL to <url-file> once listening and runs until SIGTERM.
//
// Only node builtins, so the file runs outside this repository. It is outside tsconfig and Biome
// as a fixture; the helper's import typechecks it.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** The model id that plays the plan; any other model (OpenCode's title requests) gets `TITLE`. */
export const PLANNED_MODEL = "scripted-1";
export const SMALL_MODEL = "scripted-small";
const TITLE = "Scripted session";

/** One model response: text, then tool calls with ids `call_<request>_<index>`. */
export interface ScriptedStep {
  text?: string;
  tools?: { name: string; arguments: Record<string, unknown> }[];
  delayMs?: number;
  /**
   * A file that holds this step's response until it exists, so a test lands a result while the
   * request is in flight, at a point it chose rather than inside a fixed delay.
   */
  release?: string;
}

/** How long a `release` step waits for its file before it fails the request. */
const RELEASE_WAIT_MS = 120_000;

/** A chat message as OpenCode sent it (OpenAI chat format). */
export interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  [key: string]: unknown;
}

export interface ScriptedRequest {
  /** The request's index among requests to `model`. */
  n: number;
  model: string;
  messages: ChatMessage[];
  /** The tool names the request offered. */
  tools: string[];
}

export interface ScriptedProvider {
  /** The base URL for `options.baseURL`, ending in `/v1`. */
  url: string;
  requests: ScriptedRequest[];
  close(): Promise<void>;
}

export async function startScriptedProvider(options: {
  plan: ScriptedStep[];
  /** A JSONL file each request is appended to, as well as `requests`. */
  log?: string;
}): Promise<ScriptedProvider> {
  const requests: ScriptedRequest[] = [];
  const counts = new Map<string, number>();
  const server = createServer((req, res) => {
    void answer(req, res).catch((error) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });

  async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      const data = [PLANNED_MODEL, SMALL_MODEL].map((id) => ({ id, object: "model" }));
      return json(res, { object: "list", data });
    }
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(await read(req));
    const model = String(body.model);
    const n = counts.get(model) ?? 0;
    counts.set(model, n + 1);
    const tools = (body.tools ?? []).map((tool: { function?: { name?: string } }) =>
      String(tool.function?.name),
    );
    const request: ScriptedRequest = { n, model, messages: body.messages ?? [], tools };
    requests.push(request);
    if (options.log) appendFileSync(options.log, `${JSON.stringify(request)}\n`);
    const step: ScriptedStep =
      model !== PLANNED_MODEL
        ? { text: TITLE }
        : (options.plan[n] ?? { text: `plan exhausted at request ${n}` });
    if (step.delayMs) await new Promise((done) => setTimeout(done, step.delayMs));
    if (step.release) await released(step.release);
    if (body.stream) stream(res, model, n, step);
    else json(res, completion(model, n, step));
  }

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** Until `path` exists; throws after `RELEASE_WAIT_MS`, which fails the request. */
async function released(path: string): Promise<void> {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started > RELEASE_WAIT_MS) throw new Error(`${path} was not released`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

function toolCalls(n: number, step: ScriptedStep) {
  return (step.tools ?? []).map((call, index) => ({
    index,
    id: `call_${n}_${index}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
}

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const finish = (step: ScriptedStep) => (step.tools?.length ? "tool_calls" : "stop");

function stream(res: ServerResponse, model: string, n: number, step: ScriptedStep): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const id = `chatcmpl-${model}-${n}`;
  const chunk = (choices: unknown[], extra: object = {}) =>
    res.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model, choices, ...extra })}\n\n`,
    );
  chunk([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
  if (step.text) chunk([{ index: 0, delta: { content: step.text }, finish_reason: null }]);
  const calls = toolCalls(n, step);
  if (calls.length > 0) chunk([{ index: 0, delta: { tool_calls: calls }, finish_reason: null }]);
  chunk([{ index: 0, delta: {}, finish_reason: finish(step) }]);
  chunk([], { usage });
  res.end("data: [DONE]\n\n");
}

function completion(model: string, n: number, step: ScriptedStep) {
  const calls = toolCalls(n, step).map(({ index: _, ...call }) => call);
  const message = { role: "assistant", content: step.text ?? "", ...(calls.length ? { tool_calls: calls } : {}) };
  return {
    id: `chatcmpl-${model}-${n}`,
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message, finish_reason: finish(step) }],
    usage,
  };
}

function json(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      text += chunk;
    });
    req.on("end", () => done(text));
    req.on("error", fail);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [planPath, log, urlFile] = process.argv.slice(2);
  if (!planPath || !log || !urlFile) throw new Error("usage: scripted-provider.ts <plan> <log> <url-file>");
  const provider = await startScriptedProvider({ plan: JSON.parse(readFileSync(planPath, "utf8")), log });
  writeFileSync(urlFile, provider.url);
  process.on("SIGTERM", () => void provider.close().then(() => process.exit(0)));
}
