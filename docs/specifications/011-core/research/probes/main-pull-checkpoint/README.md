# Throwaway probe: main-pull-checkpoint

Throwaway. `q.mjs` runs one read-only SQL query (`node:sqlite`, `readOnly: true`) against a
Squeal store: `node q.mjs /home/agent/projects/cezar/.git/squeal/store.sqlite "<sql>"`.
Copied from `../main-pull-reuse/q.mjs`. Queries used are listed in `../../main-pull-checkpoint.md`.
