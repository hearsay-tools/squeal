// "Product code" for l-bug-in-beforeall: a server whose start has a bug.
import { createServer, type Server } from "node:http";
export async function startServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_q, r) => r.end("ok"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port + 1}` }; // the bug: an off-by-one port
}
