// Throwaway probe (016-35). A scripted OpenAI-compatible chat-completions
// server on 127.0.0.1, so a real OMP session runs with no model and no key.
// Usage: node fake-openai.mjs <port> <script.json> <log.jsonl>
// The script is a JSON array of steps, one per model request, in order:
//   {"tool": {"name": "write", "arguments": {...}}, "waitMs": 0}
//   {"text": "..."}
// After the last step every request gets {"text": "fake: script done"}.
// Every request body is appended to the log with its time and step index, so
// the log shows exactly which text OMP sent to the model.
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, scriptPath, logPath] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(scriptPath, "utf8"));
let next = 0;

const chunk = (res, delta, finish = null) =>
  res.write(
    `data: ${JSON.stringify({
      id: "fake",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "fake-gpt",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`,
  );

createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", async () => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "fake-gpt", object: "model" }] }));
      return;
    }
    const step = steps[next] ?? { text: "fake: script done" };
    const index = next++;
    appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), step: index, url: req.url, body: JSON.parse(body || "null") })}\n`);
    if (step.waitMs) await new Promise((r) => setTimeout(r, step.waitMs));
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (step.tool) {
      chunk(res, {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_${index}`,
            type: "function",
            function: { name: step.tool.name, arguments: JSON.stringify(step.tool.arguments) },
          },
        ],
      });
      chunk(res, {}, "tool_calls");
    } else {
      chunk(res, { role: "assistant", content: step.text });
      chunk(res, {}, "stop");
    }
    res.write(`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
}).listen(Number(port), "127.0.0.1");
