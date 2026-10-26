# Repeated PostToolUse errors in Cezar task

Use /researcher. Shape: research. Bound: about 10 minutes.

Human reports repeated failed PostToolUse hooks in Cezar task c8bb31ae-1472-4b4b-bcd1-f80f2dba1b40. Its transcript is /home/agent/projects/cezar/.ai/cezar/runs/c8bb31ae-1472-4b4b-bcd1-f80f2dba1b40.ndjson; worktree has same id under .ai/cezar/worktrees/. Inspect selective transcript errors, installed hooks and Squeal versions, relevant source and daemon/store notes read-only. Do not print credentials, unrelated prompts or private content.

1. What exact hook command fails, with what exit/error, how often and when?
2. Is it a hook crash, timeout, missing runtime, intended regression block or another failure? Trace the cause against installed bundle source.
3. Is it linked to upgrades .339 to .341/.342, or independent of main’s incomplete checkpoint? State proof and limits. Name safe concrete recovery or required fix.

No messages to the affected task, no edits there, no hook execution or new runs, no daemon restart, tests, builds or installs. Own research/cezar-posttooluse.md and throwaway probes under research/probes/cezar-posttooluse/ in spec 011 only. Commit findings; exact evidence plus concise user explanation. Read 011/002/012 spec sections as needed.
