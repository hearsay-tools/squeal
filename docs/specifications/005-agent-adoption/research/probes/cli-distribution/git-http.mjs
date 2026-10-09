// Smart-HTTP git server over `git http-backend`, for scratch probes only.
import http from "node:http"; import { spawn } from "node:child_process";
const root = process.argv[2], port = Number(process.argv[3]);
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const env = { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: u.pathname,
    QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers["content-type"] ?? "",
    REMOTE_ADDR: "127.0.0.1", GIT_PROTOCOL: req.headers["git-protocol"] ?? "" };
  if (req.headers["content-encoding"]) env.HTTP_CONTENT_ENCODING = req.headers["content-encoding"];
  const p = spawn("git", ["http-backend"], { env }); req.pipe(p.stdin);
  let buf = Buffer.alloc(0), head = false;
  p.stdout.on("data", (d) => { if (head) return void res.write(d); buf = Buffer.concat([buf, d]);
    const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; head = true;
    let status = 200; for (const l of buf.subarray(0, i).toString().split("\r\n")) { const [k, ...v] = l.split(": ");
      if (k.toLowerCase() === "status") status = Number(v.join(": ").split(" ")[0]); else res.setHeader(k, v.join(": ")); }
    res.writeHead(status); res.write(buf.subarray(i + 4)); });
  p.stdout.on("end", () => res.end()); p.stderr.pipe(process.stderr);
  console.log(new Date().toISOString(), req.method, req.url);
}).listen(port, "127.0.0.1");
