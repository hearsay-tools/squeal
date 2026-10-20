# Probe: a hook payload read as a shell script

Findings in `../../cursor-dropped-args.md`. The JSON files are payloads in the shape Cursor's `preToolUse` sends: one line, compact. `output.txt` holds the commands and what dash and Node 24 printed on 2026-10-20. Each payload was parsed with `sh -n`, or run with `env -i` and a scratch `HOME`. The only command a payload runs is `echo` to stderr. `cursor-hook-log.txt` holds the Cursor log lines and `cursor-source.txt` the bundle excerpts.
