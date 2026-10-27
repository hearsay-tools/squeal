import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";

/** Real git marketplace over loopback dumb HTTP, served by a separate process. */
export async function gitMarket(base: string, market: string, env: NodeJS.ProcessEnv) {
  const bare = join(base, "market.git");
  const git = (args: string[], cwd = market) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["init", "-q", "--bare", "-b", "main", bare]);
  const publish = () => {
    git(["add", "-A"]);
    git(["-c", "user.name=e2e", "-c", "user.email=e2e@e2e", "commit", "-qm", "fixture"]);
    git(["push", "-q", bare, "main"]);
    git(["--git-dir", bare, "update-server-info"]);
  };
  publish();
  const server = spawn(
    "python3",
    [
      "-u",
      "-c",
      `import http.server,functools
handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=${JSON.stringify(base)})
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
print(server.server_address[1],flush=True)
server.serve_forever()`,
    ],
    { env },
  );
  const closed = once(server, "close");
  server.stderr.resume();
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("market HTTP startup deadline")), 5000);
    server.once("error", reject);
    server.stdout.once("data", (b: Buffer) => {
      clearTimeout(timer);
      resolve(Number(b.toString().trim()));
    });
  });
  return {
    url: `http://127.0.0.1:${port}/market.git`,
    publish,
    async close() {
      server.kill();
      await closed;
    },
  };
}
