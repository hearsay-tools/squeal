import type { Migration } from "../../store/schema.js";

/*
 * Code store schema version 1 (spec 015 D4). Its own file and `user_version`,
 * so the main store's schema never moves for it (011 C7: a raise there makes
 * every older daemon of the repository exit).
 *
 * Conventions as in the main store: times are integer epoch ms, lists are
 * JSON text, no foreign keys. A code check is stored once in `checks` and
 * referenced by its integer id everywhere else.
 *
 * - `counts`: one file's count by `(blob, language, counter_version)`, shared
 *   by every worktree; `functions` and `errors` are JSON.
 * - `files`: each worktree's included files at its current revision, the
 *   blob and key their count is stored under. Prune keeps the counts these
 *   reference. `too_big` marks a file over `complexity.maxFileBytes`, which
 *   has no count (D6).
 * - `states`, `transitions`, `views`: per worktree, after 011 C5's
 *   `known_states`, `transitions` and `consumer_views`, one row per measure.
 *   `counted_at` and `changed_at` are revisions. `edited_revision` and
 *   `edited_at` (epoch ms, comparable with a view's `told_at`) are the last
 *   edit of the check's body with its identity kept, `NULL` before one
 *   (D6's first edit to a standing failure).
 * - `coverage`: wave 2's records by result key and provider version (D8).
 *   `recorded_at` is each record's own: a record stored again at its key
 *   gets a later one (row 015-44).
 */
const V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE counts (
  blob TEXT NOT NULL,
  language TEXT NOT NULL,
  counter_version INTEGER NOT NULL,
  functions TEXT NOT NULL,
  errors TEXT NOT NULL,
  counted_at INTEGER NOT NULL,
  PRIMARY KEY (blob, language, counter_version)
) STRICT, WITHOUT ROWID;

CREATE TABLE files (
  worktree_id TEXT NOT NULL,
  path TEXT NOT NULL,
  blob TEXT NOT NULL,
  language TEXT NOT NULL,
  counter_version INTEGER NOT NULL,
  size INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  too_big INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (worktree_id, path)
) STRICT, WITHOUT ROWID;
CREATE INDEX files_by_count ON files (blob, language, counter_version);

CREATE TABLE checks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  UNIQUE (path, qualified_name, occurrence)
) STRICT;

CREATE TABLE states (
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  measure TEXT NOT NULL,
  outcome TEXT NOT NULL,
  value REAL,
  threshold REAL,
  counted_at INTEGER NOT NULL,
  blob TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  edited_revision INTEGER,
  edited_at INTEGER,
  PRIMARY KEY (worktree_id, check_id, measure)
) STRICT, WITHOUT ROWID;

CREATE TABLE transitions (
  id INTEGER PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  measure TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_outcome TEXT,
  to_outcome TEXT,
  from_value REAL,
  to_value REAL,
  threshold REAL,
  revision INTEGER NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX transitions_by_check ON transitions (worktree_id, check_id, id);

CREATE TABLE views (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  measure TEXT NOT NULL,
  outcome TEXT NOT NULL,
  threshold REAL,
  told TEXT NOT NULL,
  told_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, session_id, agent_id, check_id, measure)
) STRICT, WITHOUT ROWID;

CREATE TABLE coverage (
  result_key TEXT NOT NULL,
  provider_version INTEGER NOT NULL,
  record BLOB NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (result_key, provider_version)
) STRICT, WITHOUT ROWID;
`;

/** Every code store schema step in order. Append only; never edit a released step. */
export const CODE_MIGRATIONS: readonly Migration[] = [(db) => db.exec(V1)];

/** The code store's `user_version` this Squeal writes and understands. */
export const CODE_SCHEMA_VERSION = CODE_MIGRATIONS.length;

/**
 * Additive indexes, by name, made at open when absent with no `user_version`
 * raise, so a daemon that predates one keeps the store and SQLite keeps the
 * index current on its writes too; a reader works without them (row 015-44,
 * the coordinator's decision of 2026-10-25). `coverage_stored` gives a
 * record's `recorded_at` without its blob: a `coverage` row holds the blob,
 * 25 KiB on 011-197's store, so the table's own key reads take 0.1 ms each.
 * `coverage_recorded` gives prune the records stored before a time (row
 * 015-85). `counts_keys` holds only a count's key, so the uncounted-files
 * read (`files.uncounted`) looks each file up in narrow pages, not in the
 * table's rows of 3.5 to 7.9 KB of `functions` (row 005-103: 193 to 3.1 ms
 * on a copy); the planner keeps the primary key unless the read names it.
 * `states_failing` and `states_edited` hold only a worktree's failing and
 * edited states, the two sets each tool boundary reads (`states.list` with
 * the `fail` outcome, `states.edits`; row 015-127), so neither scans the
 * worktree's every state, 260,000 on 005-110's copy; the reads name them.
 * `states_non_pass` holds a worktree's states that do not pass, so status
 * counts them (`states.countNonPass`) without reading every passing one,
 * 67,000 complexity states on Squeal's own store (spec 025 D6.1).
 * `states_complexity_blob` and `views_by_check` let the prune test one count
 * or one check again under the write lock by a search, not a scan of
 * `states` (5.4 M rows on cezar's store) or `views` (row 021-33). The first
 * holds only complexity states, the ones whose blob a pass reads a count by
 * (`pass/bodies.ts`, row 021-38), so the crap and uncovered states a
 * coverage step or a recount writes or deletes leave it alone.
 */
export const CODE_INDEXES: Readonly<Record<string, string>> = {
  coverage_stored:
    "CREATE INDEX coverage_stored ON coverage (result_key, provider_version, recorded_at)",
  coverage_recorded: "CREATE INDEX coverage_recorded ON coverage (recorded_at)",
  counts_keys: "CREATE INDEX counts_keys ON counts (blob, language, counter_version)",
  states_failing:
    "CREATE INDEX states_failing ON states (worktree_id, measure) WHERE outcome = 'fail'",
  states_edited:
    "CREATE INDEX states_edited ON states (worktree_id, measure) WHERE edited_at IS NOT NULL",
  states_non_pass:
    "CREATE INDEX states_non_pass ON states (worktree_id, measure, outcome) WHERE outcome != 'pass'",
  states_complexity_blob:
    "CREATE INDEX states_complexity_blob ON states (blob) WHERE measure = 'complexity'",
  views_by_check: "CREATE INDEX views_by_check ON views (check_id)",
};

/**
 * Indexes this Squeal no longer makes, dropped by the code-store prune, one
 * slice under the write lock with a second look (`prune.ts`); no open drops
 * one. `states_by_blob` (row 021-33) held every state, and its upkeep took a
 * recount's switch from 70 to 125 ms; `states_complexity_blob` replaces it
 * (row 021-38). A daemon of 0.1.570 or later makes it again at its own
 * creating open, which is frequent (a locked gate call, a coverage keep
 * request); the prune runs once per clone per interval (`prune:last-at`), so
 * while both kinds run it is rebuilt at most about once an interval. Without
 * it an older prune keeps every count (`hasIndexes`).
 */
export const CODE_RETIRED_INDEXES: readonly string[] = ["states_by_blob"];

/**
 * Additive tables, by name, each with its own indexes, made at open before
 * `CODE_INDEXES` and in the same way, with no `user_version` raise (spec 015
 * D4, "An additive table after version 1", row 015-85). An older daemon's
 * statements never name them, and no existing table gains a column.
 *
 * - `coverage_parts`: each source's part of a coverage record, once, by
 *   `hash` (`src/core/code/coverage/parts.ts`). A record at its key is a
 *   manifest of part ids. `AUTOINCREMENT`, so an id is never used again.
 *   `used_at` is the newest `recorded_at` of a record that listed the part,
 *   refreshed at most every `PART_REFRESH_MS` (`./parts.ts`).
 */
export const CODE_TABLES: Readonly<Record<string, string>> = {
  coverage_parts: `
CREATE TABLE coverage_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  part BLOB NOT NULL,
  used_at INTEGER NOT NULL
) STRICT;
CREATE INDEX coverage_parts_used ON coverage_parts (used_at);
`,
};
