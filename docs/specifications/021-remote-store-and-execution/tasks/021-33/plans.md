# Row 021-33: query plans of every statement a full prune runs under the write lock

Made by `PRUNE_PLANS=1 pnpm exec vitest run test/store/prune-plans.test.ts --silent=false` at the repair of review 0.1.568 (populated tables, each statement with its own parameters). Each statement is shown once, cut at 120 characters, then its plan. The only SCAN lines are of `json_each` (the key list parameter) and `ids` (the recursive query's own rows); the test fails on any other.

## searches the main store's tables by key, never scans one

DELETE FROM revisions WHERE worktree_id = ? AND rowid IN ( SELECT rowid FROM revisions WHERE worktree_id = ? LIMIT ?)
    SEARCH revisions USING COVERING INDEX sqlite_autoindex_revisions_1 (worktree_id=?)
    LIST SUBQUERY 1
    SEARCH revisions USING COVERING INDEX sqlite_autoindex_revisions_1 (worktree_id=?)
    CREATE BLOOM FILTER
DELETE FROM file_hashes WHERE worktree_id = ? AND path IN ( SELECT path FROM file_hashes WHERE worktree_id = ? LIMIT ?)
    SEARCH file_hashes USING PRIMARY KEY (worktree_id=? AND path=?)
    LIST SUBQUERY 1
    SEARCH file_hashes USING PRIMARY KEY (worktree_id=?)
DELETE FROM test_file_keys WHERE worktree_id = ? AND rowid IN ( SELECT rowid FROM test_file_keys WHERE worktree_id = ? L
    SEARCH test_file_keys USING COVERING INDEX sqlite_autoindex_test_file_keys_1 (worktree_id=?)
    LIST SUBQUERY 1
    SEARCH test_file_keys USING COVERING INDEX sqlite_autoindex_test_file_keys_1 (worktree_id=?)
    CREATE BLOOM FILTER
DELETE FROM known_states WHERE worktree_id = ? AND rowid IN ( SELECT rowid FROM known_states WHERE worktree_id = ? LIMIT
    SEARCH known_states USING COVERING INDEX sqlite_autoindex_known_states_1 (worktree_id=?)
    LIST SUBQUERY 1
    SEARCH known_states USING COVERING INDEX sqlite_autoindex_known_states_1 (worktree_id=?)
    CREATE BLOOM FILTER
DELETE FROM transitions WHERE worktree_id = ? AND rowid IN ( SELECT rowid FROM transitions WHERE worktree_id = ? LIMIT ?
    SEARCH transitions USING COVERING INDEX transitions_by_check (worktree_id=?)
    LIST SUBQUERY 1
    SEARCH transitions USING COVERING INDEX transitions_by_check (worktree_id=?)
    CREATE BLOOM FILTER
DELETE FROM consumer_views WHERE worktree_id = ? AND rowid IN ( SELECT rowid FROM consumer_views WHERE worktree_id = ? L
    SEARCH consumer_views USING COVERING INDEX sqlite_autoindex_consumer_views_1 (worktree_id=?)
    LIST SUBQUERY 1
    SEARCH consumer_views USING COVERING INDEX sqlite_autoindex_consumer_views_1 (worktree_id=?)
    CREATE BLOOM FILTER
DELETE FROM consumers WHERE worktree_id = ? AND rowid IN ( SELECT rowid FROM consumers WHERE worktree_id = ? LIMIT ?)
    SEARCH consumers USING COVERING INDEX sqlite_autoindex_consumers_1 (worktree_id=?)
    LIST SUBQUERY 1
    SEARCH consumers USING COVERING INDEX sqlite_autoindex_consumers_1 (worktree_id=?)
    CREATE BLOOM FILTER
DELETE FROM worktrees WHERE id = ?
    SEARCH worktrees USING INDEX sqlite_autoindex_worktrees_1 (id=?)
DELETE FROM revisions WHERE worktree_id = ?
    SEARCH revisions USING INDEX sqlite_autoindex_revisions_1 (worktree_id=?)
DELETE FROM file_hashes WHERE worktree_id = ?
    SEARCH file_hashes USING PRIMARY KEY (worktree_id=?)
DELETE FROM test_file_keys WHERE worktree_id = ?
    SEARCH test_file_keys USING INDEX sqlite_autoindex_test_file_keys_1 (worktree_id=?)
DELETE FROM known_states WHERE worktree_id = ?
    SEARCH known_states USING INDEX sqlite_autoindex_known_states_1 (worktree_id=?)
DELETE FROM transitions WHERE worktree_id = ?
    SEARCH transitions USING INDEX transitions_by_check (worktree_id=?)
DELETE FROM consumer_views WHERE worktree_id = ?
    SEARCH consumer_views USING INDEX sqlite_autoindex_consumer_views_1 (worktree_id=?)
DELETE FROM consumers WHERE worktree_id = ?
    SEARCH consumers USING INDEX sqlite_autoindex_consumers_1 (worktree_id=?)
DELETE FROM meta WHERE key = ?
    SEARCH meta USING INDEX sqlite_autoindex_meta_1 (key=?)
SELECT value FROM meta WHERE key = ?
    SEARCH meta USING INDEX sqlite_autoindex_meta_1 (key=?)
DELETE FROM results WHERE rowid IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM test_file_keys k JOIN 
    SEARCH results USING INTEGER PRIMARY KEY (rowid=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 2
    SEARCH k USING INDEX test_file_keys_by_key (key=?)
    SEARCH w USING COVERING INDEX sqlite_autoindex_worktrees_1 (id=?)
    CORRELATED SCALAR SUBQUERY 3
    SEARCH m USING INDEX sqlite_autoindex_worktrees_1 (id=?)
    CORRELATED SCALAR SUBQUERY 4
    MULTI-INDEX OR
    INDEX 1
    SEARCH n USING INDEX results_by_check_time (check_id=? AND recorded_at>?)
    INDEX 2
    SEARCH n USING INDEX results_by_check_time (check_id=? AND recorded_at=? AND rowid>?)
    SEARCH m USING INDEX sqlite_autoindex_worktrees_1 (id=?)
DELETE FROM failure_texts WHERE (id) IN (SELECT value ->> 0 FROM json_each(?)) AND (NOT EXISTS (SELECT 1 FROM results r 
    SEARCH failure_texts USING COVERING INDEX sqlite_autoindex_failure_texts_1 (id=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    LIST SUBQUERY 3
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CREATE BLOOM FILTER
    CORRELATED SCALAR SUBQUERY 2
    SEARCH r USING COVERING INDEX results_by_failure (failure_id=?)
DELETE FROM loaded_modules WHERE (project, path, key) IN (SELECT value ->> 0, value ->> 1, value ->> 2 FROM json_each(?)
    SEARCH loaded_modules USING PRIMARY KEY (project=? AND path=? AND key=?)
    LIST SUBQUERY 3
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 2
    SEARCH r USING COVERING INDEX results_by_key (key=?)
DELETE FROM runs WHERE id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = r
    SEARCH runs USING INDEX sqlite_autoindex_runs_1 (id=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    LIST SUBQUERY 3
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CREATE BLOOM FILTER
    USING INDEX sqlite_autoindex_worktrees_1 FOR IN-OPERATOR
    CORRELATED SCALAR SUBQUERY 2
    SEARCH r USING COVERING INDEX results_by_run (run_id=?)
DELETE FROM checkpoints WHERE (id) IN (SELECT value ->> 0 FROM json_each(?)) AND (NOT EXISTS (SELECT 1 FROM runs r WHERE
    SEARCH checkpoints USING INDEX sqlite_autoindex_checkpoints_1 (id=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 2
    SEARCH r USING COVERING INDEX runs_by_checkpoint (checkpoint_id=?)
    CORRELATED SCALAR SUBQUERY 3
    SEARCH w USING COVERING INDEX sqlite_autoindex_worktrees_1 (id=?)
    CORRELATED SCALAR SUBQUERY 4
    SEARCH x USING INDEX checkpoints_by_worktree (worktree_id=? AND end_state=?)
WITH RECURSIVE ids(id) AS ( SELECT min(worktree_id) FROM known_states UNION ALL SELECT (SELECT min(worktree_id) FROM kno
    CO-ROUTINE ids
    SETUP
    SEARCH known_states USING COVERING INDEX sqlite_autoindex_known_states_1
    RECURSIVE STEP
    SCAN ids
    CORRELATED SCALAR SUBQUERY 2
    SEARCH known_states USING COVERING INDEX sqlite_autoindex_known_states_1 (worktree_id>?)
    SCAN ids
WITH RECURSIVE ids(id) AS ( SELECT min(worktree_id) FROM transitions UNION ALL SELECT (SELECT min(worktree_id) FROM tran
    CO-ROUTINE ids
    SETUP
    SEARCH transitions USING COVERING INDEX transitions_by_check
    RECURSIVE STEP
    SCAN ids
    CORRELATED SCALAR SUBQUERY 2
    SEARCH transitions USING COVERING INDEX transitions_by_check (worktree_id>?)
    SCAN ids
DELETE FROM checks WHERE (id) IN (SELECT value ->> 0 FROM json_each(?)) AND (NOT EXISTS (SELECT 1 FROM results r WHERE r
    SEARCH checks USING INTEGER PRIMARY KEY (rowid=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 2
    SEARCH r USING COVERING INDEX results_by_check_time (check_id=?)
    CORRELATED SCALAR SUBQUERY 4
    SEARCH s USING COVERING INDEX sqlite_autoindex_known_states_1 (worktree_id=? AND check_id=?)
    LIST SUBQUERY 3
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 6
    SEARCH t USING COVERING INDEX transitions_by_check (worktree_id=? AND check_id=?)
    LIST SUBQUERY 5
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 7
    SEARCH v USING COVERING INDEX consumer_views_by_check (check_id=?)

## searches the code store's tables by key, never scans one

DELETE FROM files WHERE (worktree_id, path) IN (SELECT value ->> 0, value ->> 1 FROM json_each(?)) AND (worktree_id = ?)
    SEARCH files USING PRIMARY KEY (worktree_id=? AND path=?)
    LIST SUBQUERY 2
    SCAN json_each VIRTUAL TABLE INDEX 1:
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CREATE BLOOM FILTER
DELETE FROM states WHERE (worktree_id, check_id, measure) IN (SELECT value ->> 0, value ->> 1, value ->> 2 FROM json_eac
    SEARCH states USING PRIMARY KEY (worktree_id=? AND check_id=? AND measure=?)
    LIST SUBQUERY 2
    SCAN json_each VIRTUAL TABLE INDEX 1:
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CREATE BLOOM FILTER
DELETE FROM transitions WHERE (worktree_id, check_id, id) IN (SELECT value ->> 0, value ->> 1, value ->> 2 FROM json_eac
    SEARCH transitions USING COVERING INDEX transitions_by_check (worktree_id=? AND check_id=? AND id=?)
    LIST SUBQUERY 2
    SCAN json_each VIRTUAL TABLE INDEX 1:
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CREATE BLOOM FILTER
DELETE FROM meta WHERE (key) IN (SELECT value ->> 0 FROM json_each(?)) AND (key LIKE 'coverage:%' AND (CASE WHEN instr(s
    SEARCH meta USING COVERING INDEX sqlite_autoindex_meta_1 (key=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    LIST SUBQUERY 2
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CREATE BLOOM FILTER
DELETE FROM views WHERE (worktree_id, session_id, agent_id, check_id, measure) IN (SELECT value ->> 0, value ->> 1, valu
    SEARCH views USING PRIMARY KEY (worktree_id=? AND session_id=? AND agent_id=? AND check_id=? AND measure=?)
    LIST SUBQUERY 3
    SCAN json_each VIRTUAL TABLE INDEX 1:
    LIST SUBQUERY 2
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CREATE BLOOM FILTER
DELETE FROM counts WHERE (blob, language, counter_version) IN (SELECT value ->> 0, value ->> 1, value ->> 2 FROM json_ea
    SEARCH counts USING PRIMARY KEY (blob=? AND language=? AND counter_version=?)
    LIST SUBQUERY 4
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 2
    SEARCH f USING COVERING INDEX files_by_count (blob=? AND language=? AND counter_version=?)
    CORRELATED SCALAR SUBQUERY 3
    SEARCH s USING COVERING INDEX states_by_blob (blob=?)
DELETE FROM coverage WHERE (result_key, provider_version) IN (SELECT value ->> 0, value ->> 1 FROM json_each(?)) AND (re
    SEARCH coverage USING PRIMARY KEY (result_key=? AND provider_version=?)
    LIST SUBQUERY 2
    SCAN json_each VIRTUAL TABLE INDEX 1:
DELETE FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?)) AND used_at < ?
    SEARCH coverage_parts USING INTEGER PRIMARY KEY (rowid=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
WITH RECURSIVE ids(id) AS ( SELECT min(worktree_id) FROM states UNION ALL SELECT (SELECT min(worktree_id) FROM states WH
    CO-ROUTINE ids
    SETUP
    SEARCH states USING PRIMARY KEY
    RECURSIVE STEP
    SCAN ids
    CORRELATED SCALAR SUBQUERY 2
    SEARCH states USING PRIMARY KEY (worktree_id>?)
    SCAN ids
WITH RECURSIVE ids(id) AS ( SELECT min(worktree_id) FROM transitions UNION ALL SELECT (SELECT min(worktree_id) FROM tran
    CO-ROUTINE ids
    SETUP
    SEARCH transitions USING COVERING INDEX transitions_by_check
    RECURSIVE STEP
    SCAN ids
    CORRELATED SCALAR SUBQUERY 2
    SEARCH transitions USING COVERING INDEX transitions_by_check (worktree_id>?)
    SCAN ids
DELETE FROM checks WHERE (id) IN (SELECT value ->> 0 FROM json_each(?)) AND (NOT EXISTS (SELECT 1 FROM states s WHERE s.
    SEARCH checks USING INTEGER PRIMARY KEY (rowid=?)
    LIST SUBQUERY 1
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 3
    SEARCH s USING PRIMARY KEY (worktree_id=? AND check_id=?)
    LIST SUBQUERY 2
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 5
    SEARCH t USING COVERING INDEX transitions_by_check (worktree_id=? AND check_id=?)
    LIST SUBQUERY 4
    SCAN json_each VIRTUAL TABLE INDEX 1:
    CORRELATED SCALAR SUBQUERY 6
    SEARCH v USING COVERING INDEX views_by_check (check_id=?)

