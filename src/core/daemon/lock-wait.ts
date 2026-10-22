/*
 * Row 014-43 (h): a leaf, so `squeal ps` reads the wait from the code that
 * waits (`openDaemon`) without the modules `open.ts` pulls in.
 */

/**
 * Task 001-340: how long a daemon started without `--await-lock` waits for a
 * lock it lost while no daemon is recorded serving. The holder's shutdown
 * has cleared its record and closed its socket, so only its lock release
 * remains, a few milliseconds that an I/O stall on a loaded host stretched
 * past 8 s (task 001-337); the successor's 2 minutes cover a tier in flight,
 * which this holder has finished.
 */
export const VACANT_LOCK_WAIT_MS = 30_000;
