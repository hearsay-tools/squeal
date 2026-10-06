# Specifications

One folder per feature or subsystem. Folder name is `NNN-short-title`, numbered in the order work started.

Each folder contains:

- `spec.md`: the agreed design. Written before implementation, kept current after.
- `status.md`: stage (`draft`, `approved`, `in-progress`, `shipped`, `superseded`), linked issues and PRs, open questions.
- `lessons.md` (optional): what we learned once it shipped.
- `attachments/` (optional): preserved snapshots, sample payloads, logs.

Use `TEMPLATE.md` for a new spec. Reference code by commit hash or PR number; do not paste code that will drift.

## Index

| # | Feature | Stage |
|---|---------|-------|
| 001 | Core validation loop (watcher, revisions, Vitest adapter, state, events, status) | shipped-candidate |
