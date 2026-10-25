# Wave 43.5: repair of cand/0.1.329

From review `reviews/0.1.329.md` (FAIL at `3ccc880d9`, reviewer 867c1958): three proven blockers and one should-fix. One repair round, then one re-review on the new candidate. Same owners and files as wave 43; the seams stay disjoint. Each worker resumes on its own branch and commits there; the coordinator moves the commits onto the candidate.

## R1, row 011-226 (worker 75b74928): B1, B3 and S1

Use /worker. Shape: repair. Read the review's B1, B3, S1 and "Inputs for the repair wave".
- **B1:** a stopped or unrun check gives its claim back even when the store is busy at release. Keep the obligation, retry it without blocking the event loop, finish it before the store closes, and keep the compare against the claimed value.
- **B3:** bind the recorded store file identity to the connection that opened it. Capture the identity in step with recovery, or detect a changed pathname at open and retry. A stale connection never serves, or is condemned at its next heartbeat.
- **S1:** take the claim with C8's short busy waits and async retry, not one 5 s synchronous wait.

Done when the review's probes are tests that fail on `3ccc880d9` and pass: busy release after stop and after unrun, then a later start claims; the open-versus-recovery interleaving; the claim with a held writer leaves the main thread free.

## R2, row 011-227 (worker 26898378): B2

Use /worker. Shape: repair. Read the review's B2. The early commit must keep the predecessor's queued and running work durable until the second commit settles it. Keep the rule that a recheck hit is not queued at its first key.

Done when tests restart from an image saved after the first commit (the review's `VACUUM INTO` probe) and the predecessor's queued and running files are still handed over. One of these tests has a second lookup that hits.

Verification for both: `npm run lint`, `npm run typecheck`, `squeal status --wait 60000 <changed paths>`; no full suite; no `npm run build`.
