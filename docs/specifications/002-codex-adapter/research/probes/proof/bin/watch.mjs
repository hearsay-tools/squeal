// Throwaway: poll a scratch repository's Squeal store every 100 ms and print a
// JSON line whenever the consumers, their views, the transitions or the
// revision change. Stops on SIGTERM.
//   node watch.mjs <repo> > store.jsonl
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = `${process.argv[2]}/.git/squeal/store.sqlite`;
let last = "";
const tick = () => {
  if (!existsSync(db)) return;
  let s;
  try {
    s = new DatabaseSync(db, { readOnly: true });
    const consumers = s
      .prepare("SELECT session_id, agent_id, registered_at, last_delivered_at FROM consumers ORDER BY registered_at")
      .all();
    const views = s
      .prepare(
        "SELECT v.session_id, v.agent_id, c.full_name AS name, v.outcome FROM consumer_views v JOIN checks c ON c.id = v.check_id ORDER BY v.session_id, v.agent_id, c.full_name",
      )
      .all()
      .map((v) => `${v.session_id.slice(0, 8)}/${v.agent_id.slice(0, 8)} ${v.name} ${v.outcome}`);
    const transitions = s
      .prepare(
        "SELECT t.id, c.full_name AS name, t.from_outcome, t.to_outcome, t.revision, t.at FROM transitions t JOIN checks c ON c.id = t.check_id ORDER BY t.id",
      )
      .all();
    const revision = s.prepare("SELECT max(number) AS r FROM revisions").get()?.r;
    const state = { consumers, views, transitions, revision };
    const key = JSON.stringify(state);
    if (key !== last) {
      last = key;
      console.log(JSON.stringify({ t: Date.now(), ...state }));
    }
  } catch (e) {
    console.log(JSON.stringify({ t: Date.now(), error: String(e) }));
  } finally {
    s?.close();
  }
};
setInterval(tick, 100);
process.on("SIGTERM", () => process.exit(0));
