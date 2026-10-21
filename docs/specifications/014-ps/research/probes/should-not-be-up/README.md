# Probe: should-not-be-up (014-03)

Throwaway. Not product code; delete with the research once spec 014 is written.

`scan.py` applies the flag rules of `../../should-not-be-up.md` to the live host, read-only:

- `/proc/<pid>/{cmdline,stat,status,environ,fd}`, `/proc/locks`, `/proc/net/unix`, `/proc/loadavg`, `/proc/pressure/cpu`, `/proc/meminfo`;
- `ls`/`stat` of `$XDG_RUNTIME_DIR`, `/tmp/squeal-<uid>`, `/tmp/squeal-e2e-*` and the stores' `locks/`;
- each store opened with SQLite `mode=ro` (no write, no schema change), one short read transaction per store;
- `~/.claude/plugins/installed_plugins.json` and the Codex plugin cache, for the installed versions.

It never connects to a daemon socket, never signals, renices or stops a process, and never writes outside its `--out` file.

Run: `python3 -I scan.py --out /tmp/r1403/scan.json > /tmp/r1403/scan.txt`. The committed `scan-<UTC time>.txt` files are its output on the host.
