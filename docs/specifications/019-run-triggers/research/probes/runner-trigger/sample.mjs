// Throwaway (019-01): prints a few rows of runs from a store opened read-only.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
console.log(db.prepare("SELECT test_files, started_at, ended_at, end_state, checkpoint_id FROM runs ORDER BY started_at DESC LIMIT 3").all());
console.log(db.prepare("SELECT count(*) n, min(started_at) a FROM runs").get());
console.log(db.prepare("SELECT kind, project, count(*) n FROM checks GROUP BY kind, project ORDER BY n DESC LIMIT 15").all());
