// queue-sample.mjs <store.sqlite> <out.tsv> <seconds>: every 2 s one line:
// epoch ms, the heartbeat's age (ms since daemon_heartbeat_at), and the
// worktree's test files queued and running (test_file_keys.pending). One
// read-only query pair per sample; a busy store skips the sample.
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, writeFileSync } from "node:fs";
const [store, out, secs] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true, timeout: 200 });
writeFileSync(out, "t_ms\thb_age_ms\tqueued\trunning\n");
const end = Date.now() + Number(secs) * 1000;
const tick = () => {
  try {
    const now = Date.now();
    const hb = db.prepare("select max(daemon_heartbeat_at) hb from worktrees").get().hb;
    const counts = Object.fromEntries(
      db.prepare("select pending, count(*) n from test_file_keys group by pending").all().map((r) => [r.pending, r.n]),
    );
    appendFileSync(out, `${now}\t${hb === null ? "" : now - hb}\t${counts.queued ?? 0}\t${counts.running ?? 0}\n`);
  } catch (e) {
    appendFileSync(out, `${Date.now()}\tbusy\t\t\n`);
  }
  if (Date.now() < end) setTimeout(tick, 2000);
};
tick();
