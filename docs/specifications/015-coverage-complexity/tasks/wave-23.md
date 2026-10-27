# Wave 23: retain the last good coverage policy

HELD: dispatch only after coordinator 04a258b0 agrees on the daemon seam. The request and follow-up are in the shared coordination note. No implementation starts merely because the candidate review passed.

## W1 — 015-87

Use /worker. Shape: repair. A malformed config save must keep the last good complexity and coverage settings, so restoring the good config does not run every check twice. Read spec D1/D8/D9, status, the board row, and 011 C10 Projects at a reload. Start at daemon.ts #reloadPolicy: beside retained nodeTest/pytest, keep complexity/coverage when unparsed is true. Own only that method and its comment, a new test/daemon/reload-coverage.test.ts, and tasks/015-87/notes.md. Read the existing reload-projects kit/tests; leave them unchanged unless an additive helper is agreed first. Leave scheduler, policy defaults, valid-config reload behavior, lint and other daemon methods alone.

Done when red-first real-daemon tests load a good coverage-off policy with nondefault complexity, save malformed JSON, then restore the original policy: check keys and run counts do not change from either save, and complexity settings remain. Also prove valid coverage changes still re-key as intended, with no restart. Existing reload-projects cases hold. Run lint/typecheck and affected Squeal checks; report pending/unknown checks honestly. No bundle, version or full-suite work. Commit the repair and notes; report additive types and unresolved questions.
