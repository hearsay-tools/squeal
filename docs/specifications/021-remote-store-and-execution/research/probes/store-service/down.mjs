// Throwaway (021-01). What each client does with its default options when the server is
// paused (`docker pause`: the port accepts, nothing answers) or absent (refused port).
// node down.mjs <pg|valkey|http> <port>   (run from a directory with pg and iovalkey installed)
const [kind, port] = process.argv.slice(2);
const t0 = Date.now();
const done = (what) => { console.log(`${kind} :${port} -> ${what} after ${Date.now() - t0} ms`); process.exit(0); };
setTimeout(() => done("still waiting (outer limit)"), 20000).unref?.();
setTimeout(() => {}, 21000);
try {
  if (kind === "pg") {
    const { default: pg } = await import(`${process.cwd()}/node_modules/pg/lib/index.js`);
    const c = new pg.Client({ host: "127.0.0.1", port: Number(port), user: "postgres", password: "bench" });
    await c.connect(); await c.query("select 1"); done("answered");
  } else if (kind === "valkey") {
    const { default: Valkey } = await import(`${process.cwd()}/node_modules/iovalkey/built/index.js`);
    const c = new Valkey({ host: "127.0.0.1", port: Number(port) });
    c.on("error", () => {});
    await c.mget("a", "b"); done("answered");
  } else {
    const r = await fetch(`http://127.0.0.1:${port}/ac/${"0".repeat(64)}`); done(`answered ${r.status}`);
  }
} catch (e) { done(`error ${e.code ?? ""} ${String(e.message).slice(0, 80)}`); }
