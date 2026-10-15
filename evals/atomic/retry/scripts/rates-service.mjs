// The rates service: today's exchange rates over HTTP on 127.0.0.1, at a port the system picks,
// written to ~/.ledgerline-rates.port. `node scripts/rates-service.mjs` starts it in the
// background and returns once it listens; it stops when its port file is removed. Each start
// also appends what it said to ~/.ledgerline-rates.starts.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RATES = { "EUR/USD": 1.08, "USD/EUR": 0.93, "GBP/USD": 1.27, "USD/GBP": 0.79 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const portIn = (file) => {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
};

const say = (line, to = console.log) => {
  to(line);
  appendFileSync(join(homedir(), ".ledgerline-rates.starts"), `${line}\n`);
};

if (process.argv[2] === "--serve") serve(process.argv[3]);
else await start(join(homedir(), ".ledgerline-rates.port"));

async function start(file) {
  const port = portIn(file);
  if (
    port !== null &&
    (await fetch(`http://127.0.0.1:${port}/health`).then(
      (r) => r.ok,
      () => false,
    ))
  ) {
    say(`rates service already running on 127.0.0.1:${port}`);
    return;
  }
  rmSync(file, { force: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--serve", file], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 200 && !existsSync(file); i++) await sleep(25);
  if (!existsSync(file)) {
    say("the rates service did not start", console.error);
    process.exit(1);
  }
  say(`rates service listening on 127.0.0.1:${portIn(file)}`);
}

function serve(file) {
  const server = createServer((request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.url === "/health") return send(200, { ok: true });
    const v1 = /^\/v1\/rates\/([A-Z]{3})\/([A-Z]{3})$/.exec(request.url ?? "");
    const pair = v1 && `${v1[1]}/${v1[2]}`;
    if (pair && pair in RATES) return send(200, { rate: RATES[pair] });
    if (/^\/v\d+\/rates\//.test(request.url ?? "")) return send(503, { error: "unavailable" });
    return send(404, { error: "not found" });
  });
  server.listen(0, "127.0.0.1", () => {
    const port = String(server.address().port);
    writeFileSync(file, `${port}\n`);
    const stop = () => {
      if (portIn(file) === port) rmSync(file, { force: true });
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    // Gone with its port file: removed, or naming another service.
    setInterval(() => portIn(file) !== port && process.exit(0), 500);
  });
}
