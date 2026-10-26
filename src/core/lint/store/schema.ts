import type { Migration } from "../../store/schema.js";

/*
 * Lint store schema version 1 (spec 017 D6). Its own file and
 * `user_version`, so neither the main store's schema nor `code.sqlite`'s
 * moves for it: a raise there makes every older daemon lose that store
 * (`lint-seams.md` F4.3).
 *
 * Conventions as in the main and code stores: times are integer epoch ms,
 * revisions integers, lists JSON text, no foreign keys. A lint check is
 * stored once in `checks` and referenced by its integer id everywhere else.
 *
 * - `results`: one file's findings at one key, shared by every worktree,
 *   keyed by check and key as the main store's results (D5). `findings` is
 *   JSON in ESLint's order; `fingerprint` is `NULL` for a `pass`. `used_at`
 *   is the last time a worktree took it, for retention.
 * - `states`, `transitions`, `views`: per worktree, after 015 D4's. A
 *   state's `judged_*` columns are the result it was last judged on, kept
 *   while it is `pending`, `unknown` or `stale`; all `NULL` before the
 *   first. `judged_revision` and `changed_at` are revisions. A transition's
 *   `added` and `removed` are JSON findings, evidence only (D2).
 */
const V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE checks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  tool TEXT NOT NULL,
  UNIQUE (path, tool)
) STRICT;

CREATE TABLE results (
  check_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  findings TEXT NOT NULL,
  fingerprint TEXT,
  tool_version TEXT NOT NULL,
  linted_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (check_id, key)
) STRICT, WITHOUT ROWID;

CREATE TABLE states (
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  judged_key TEXT,
  judged_outcome TEXT,
  judged_fingerprint TEXT,
  judged_blob TEXT,
  judged_revision INTEGER,
  stale INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, check_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE transitions (
  id INTEGER PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  added TEXT NOT NULL,
  removed TEXT NOT NULL,
  revision INTEGER NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX transitions_by_check ON transitions (worktree_id, check_id, id);

CREATE TABLE views (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  fingerprint TEXT,
  told TEXT NOT NULL,
  told_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, session_id, agent_id, check_id)
) STRICT, WITHOUT ROWID;
`;

/** Every lint store schema step in order. Append only; never edit a released step. */
export const LINT_MIGRATIONS: readonly Migration[] = [(db) => db.exec(V1)];

/** The lint store's `user_version` this Squeal writes and understands. */
export const LINT_SCHEMA_VERSION = LINT_MIGRATIONS.length;
