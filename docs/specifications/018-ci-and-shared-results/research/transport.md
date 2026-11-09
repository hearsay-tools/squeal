# Research: transport (018-14)

Researcher c3d2a5c6 for spec 018, 2026-11-09. Brief: `tasks/wave-4.md`, topic `transport` in `README.md`. This repository at `fdb16d0f6`. git 2.43.0, Node 24.22.1, 24 vCPUs. Timings only at one-minute load below 24 (22.3 to 23.5); runs above it are named. GitHub docs read as Markdown from `docs.github.com/api/article/body` on 2026-11-09. Read-only on GitHub and on `~/projects/cezar`. Probes: `probes/transport/` (throwaway; its README holds every output). Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred. This extends `remote-store.md` Q4 to Q6 and does not repeat it.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Writing the ref | Use **one ref per main commit, `refs/squeal/<sha>`**, not one notes ref. Concurrent writers to one notes ref are rejected and must fetch, merge and retry. Per-commit refs never conflict. The writing job needs `contents: write`. The test jobs keep `contents: read`, because a `merge_group` run executes the pull request's code. Rulesets cannot protect either kind of ref: they target only branches and tags. | exp, docs, inf |
| 2 | Retention | About 2.1 MB per main commit. With gzip, git cannot store an export as a delta, so the origin holds K × 2.1 MB. Keep the last 50 to 100 main commits: in cezar that is 1 to 2 days and covers every worktree active in the last 24 h. The writer prunes by deleting old refs. | exp, docs |
| 3 | The reader | At daemon start and when `HEAD` moves to a new nearest main commit, in the background: one `git fetch` of one ref, about 0.6 s plus 2 MB (1.3 to 2.5 s) here. Use `--no-write-fetch-head`, `--no-auto-maintenance`, `GIT_TERMINAL_PROMPT=0`, ssh `BatchMode`, and Squeal's own kill timer. Never add a refspec to the user's config. Offline: a failed fetch is a miss. | exp, docs, inf |
| 4 | Which export | The nearest first-parent ancestor of `merge-base(HEAD, <remote>/<default branch>)` that has an export. In cezar it is the merge base itself for 367 of 368 main commits. Import one export per start point. Never fill gaps from older exports, because a failed file is absent from an export, not marked failed. | exp, inf |
| 5 | Trust from git alone | git alone proves only *which commit* an export claims: the commit is on the default branch's first-parent line, and the ref name matches the header. It cannot prove *who wrote it*. Anyone with write access can push `refs/squeal/*`. Stronger proof (artifact attestations) needs `gh` and the network, so it is outside git. | exp, docs, inf |

## Findings

### Q1. Writing the ref: token, rules, concurrent writers

**Per-commit refs over notes** **[exp]** (`concurrent.sh`, `notes-2mb.sh`, `retention.sh`):
- Two writers push `refs/notes/squeal` at the same time. One is refused: `cannot lock ref 'refs/notes/squeal': is at d024dd7… but expected 196dafa…`. It recovers with `git fetch`, `git notes merge`, then a new push. Two writers push `refs/squeal/<sha>` refs at the same time, and both succeed.
- A notes ref is all or nothing for a reader. A new reader fetches every retained note: 1 to 5 notes of 2 MB took 130 to 800 ms on local disk, and 12 notes were 24.9 MB. A reader that is one note behind gets 2.0 MB for that note. A per-commit ref gives exactly the export needed: 2.1 MB, 125 to 206 ms on local disk.
- `git notes add -F` treats the file as message text, so it changes a binary export. `-C <blob>` stores the blob unchanged. The probe `remote-store/git-ref.sh` used `-F` with JSON.
- With protocol v2 (git's default), a developer's plain `git fetch` does not list `refs/squeal/*`: 0 lines for 400 refs. With protocol v0 it lists all 400 (800 packet lines) (`refs-scale.sh`).
- A ref can point at a blob directly, and a local push accepted it. A commit with a tree is the safer form, because the docs read do not say whether GitHub accepts a ref that points at a blob **[exp][inf]**.
- GitHub serves notes refs: `git ls-remote https://github.com/git/git 'refs/notes/*'` lists `refs/notes/amlog` **[exp]**. Pushing a custom ref to GitHub was not tried (read-only).

**Token** **[docs]**: "The `GITHUB_TOKEN` secret is a GitHub App installation access token … limited to the repository that contains your workflow". Permissions are set per job: "If you specify the access for any of these permissions, all of those that are not specified are set to `none`". Write access is reduced to read only for "a pull request event other than `pull_request_target` from a forked repository". `merge_group` and `push` are not pull request events, so a job in them can get `contents: write`. No page names `merge_group` separately **[inf]**. A push with the token starts no other workflow: "if a workflow run pushes code using the repository's `GITHUB_TOKEN`, a new workflow will not run". cezarion sets `permissions: contents: read` at workflow level, so one writer job would set `contents: write` **[src: cezarion ci.yml]**.

**Isolation** **[docs][inf]**: a `merge_group` run tests code from the queued pull requests. `actions/checkout`: "The auth token is persisted in the local git config … Set `persist-credentials: false` to opt-out". So the push belongs in a separate job, `needs:` the test shards, that runs no repository code: it downloads the export artifacts and pushes one ref. The hardening guide asks for "the least privileges required".

**Where to write** **[exp][inf]**: in cezar, `merge_group` SHAs are the main commits (squash merges; 367 of 368 main commits since 2026-11-01 have a successful run at that exact SHA). There are two choices:
- A writer job at the end of the `merge_group` run. The export exists before main moves. 3 of 370 successful group SHAs never reached main; they leave orphan refs, which readers skip (Q5) and the writer prunes.
- A job on `push` to main. It writes only main SHAs, and `GITHUB_REF` is `refs/heads/main`. It must find the exact-SHA `merge_group` run and download its artifact (`actions: read`), as cezarion's `queue-proof` job already finds that run. Its cost is a short job and a lag of one job.

The attribution question itself belongs to `ci-step` Q5.

**Rulesets** **[docs]**: "You can use rulesets to target branches or tags in a repository or to block pushes to a repository". Push rulesets block pushes by "file extensions, file path lengths, file and folder paths, and file sizes", only "to a private or internal repository" (cezarion is public). "Restrict creations/updates/deletions" act on "branches or tags whose name matches the pattern". So nothing stops a writer from creating, moving or deleting `refs/squeal/*` or `refs/notes/*`. Bypass lists hold roles, teams, "GitHub Apps" and Dependabot; the pages read do not say whether the built-in Actions app can be chosen. Only a branch (`refs/heads/…`) could be guarded. But every developer's default fetch would then download every export, unless each clone adds a negative refspec **[inf]**. Not determined: whether a push ruleset's path rule applies to pushes of non-branch refs.

**Limits** **[docs]**: push rate "recommended maximum limit is 6 pushes per minute"; cezar lands 46 commits a day. Single object: "recommended maximum limit is 1MB. This is enforced at 100 MB". A 2.1 MB export is above the recommendation and far below the block. Splitting by project would bring most parts under 1 MB **[inf]**. Branches: "5,000"; no limit is stated for other refs (cezarion already has 1,490 `refs/pull/*`) **[exp: ls-remote]**.

### Q2. Retention: how many, how big, pruning

- **Size** **[exp]**: the trial export is 2,074,272 bytes gzipped (33.2 MB JSON). Over 12 synthetic successors (35% of files re-key per commit; every duration changes), the origin after `gc` held 24.9 MB as gzipped blobs and 11.0 MB as raw JSON. git cannot delta gzipped blobs; it stores raw JSON as about 0.8 MB deltas. With durations kept stable for unchanged files, raw JSON took 6.0 MB for 12.
- **What a reader receives** **[exp]**: about one export (2.1 MB), whatever the layout. Per-commit refs carry no ancestry, so no thin pack is possible. A chain of commits (parent = previous export) allows one: the next raw export travelled as **802,594 bytes with the origin's `pack.useBitmaps=false`, and 2,184,465 bytes with `true`**. `true` is git's default on a bare repository after a full repack ("Defaults to true on bare repos"). Whether GitHub sends thin deltas here is not determined. So plan for 2 MB per fetch.
- **How many** **[exp]**: of cezar's 69 worktrees, the 18 whose index changed in the last 24 h are behind main by p50 1, p90 12, max 43 first-parent commits. **Keeping 50 covers all 18.** For the last 72 h (29 worktrees), keeping 50 covers 21 and keeping 100 covers 24. The rest are older than 500 commits. At 46.4 commits a day, 50 refs is about one day, 100 MB on the origin; 100 refs is about two days, 210 MB. On-disk guidance is "10 GB".
- **Pruning** **[exp]**: per-commit refs are pruned with `git push origin --delete refs/squeal/<old>`, which the writer job can run for every ref beyond K in the same push. A notes ref keeps all history until it is rewritten. A parentless commit with the last K notes, force-pushed, cut the origin from 24.9 MB to 10.4 MB (K = 5). Not determined: when GitHub removes the objects of a deleted ref.
- **Locally** **[exp][docs]**: a fetch with no destination ref reads the export and leaves no ref (`no-ref.sh`). The objects are then unreachable, and `git gc` prunes them after "2.weeks.ago". Local refs would show in `git log --all`: 2 of 5 commits there were result commits.

### Q3. The reader: when, which command, cost, offline

- **When** **[inf]**: at daemon start, and when `HEAD` moves so that its nearest main ancestor (Q4) changes. Squeal already watches `HEAD`, and git has no post-fetch hook (`remote-store.md` Q4). A `git pull` or a rebase onto main moves `HEAD`, so a periodic poll is not needed. A worktree that does not move needs no new export. The fetch is needed only when no export for that commit is in the store yet. Linked worktrees share refs and objects (`reader.sh` 6), and they share the store, so one fetch serves every worktree of a clone.
- **Command** **[exp][docs]**: `git fetch --no-write-fetch-head --no-auto-maintenance <remote> refs/squeal/<sha>` (or into a temporary ref), then read the blob. Without `--no-write-fetch-head`, the fetch rewrote the user's `FETCH_HEAD` (`reader.sh` 4). Without `--no-auto-maintenance`, fetch runs "git maintenance run --auto at the end … enabled by default". A missing export answers in one round trip: `couldn't find remote ref`, exit 128.
- **Never edit the user's remote config** **[exp]**: an explicit configured refspec for a ref that the remote lacks makes the user's own `git fetch` exit 128 and `git pull` exit 1. A wildcard refspec does not fail, but it would download every retained export on every fetch.
- **Cost here** **[exp]**: to GitHub through this host's HTTPS proxy, `git ls-remote` took 449 to 608 ms, a one-commit fetch 593 to 701 ms, and the 2 MB trial export through `gh run download` 1.3 to 2.5 s. One import is therefore about 2 to 3 s of background network time and 2 MB. On local disk it is 125 to 206 ms. `squeal import` of that file took about 2 s (`import-trial.md` count 3).
- **Never block a hook** **[exp][inf]**: the fetch runs in the daemon only, never in a hook, and it has a kill timer.
  - A refused connection fails at once.
  - An unroutable HTTP remote was still waiting when `timeout` stopped it at 20 s. git sets no HTTP connect timeout of its own **[inf]**; the manual describes `http.lowSpeedLimit` and `http.lowSpeedTime` as a limit on "the HTTP transfer speed".
  - ssh with `-o BatchMode=yes -o ConnectTimeout=3` gave up at 3.0 s.
  - A remote that asks for credentials, with `GIT_TERMINAL_PROMPT=0`, failed with `terminal prompts disabled` instead of waiting for input.
  - Offline: the fetch fails, and the files run locally as today.
  - The prior art turns the remote off after a failure (Gradle, `remote-store.md` Q3). Here the next try comes at the next `HEAD` move or start.

### Q4. Which export for a worktree at commit X

- **Rule** **[inf]**: find M = `merge-base(X, <remote>/<default branch>)`, then walk `git rev-list --first-parent M` to the first commit with an export. A stale local main does not matter, as long as it contains M. The default branch comes from `refs/remotes/<remote>/HEAD`.
- **cezar** **[exp]**: 367 of 368 main commits (7.9 days) have a successful `merge_group` run at the exact SHA. In 41 of 42 sampled runs all four Vitest shards ran; one skipped them. So the nearest export is M itself, except for the about 2% of commits whose run skips tests. With 368 stand-in refs, the lookup took 18 to 23 ms.
- **Several** **[inf]**: import one export, the nearest. An older export adds keys only for files whose content the worktree shares with the older commit. The nearest export already covers those files, unless the nearest export left them out. D2 leaves a file out whole when it failed at its key, and an export does not list its left-out files. So an older export with a pass at the same key would turn a CI failure at M into a pass. If several exports are ever wanted, an export must first list its left-out files with the reason.

### Q5. Trust: what git alone proves

- **Provable from git** **[exp][inf]**:
  - The export's commit is on the first-parent line of `<remote>/<default branch>`. This rejects orphan merge-group SHAs and exports of pull request branches.
  - The ref name equals `header.commit`.
  - The header names the repository (`source.repository`), and it can be compared with the remote URL.
- **Not provable from git** **[docs][inf]**:
  - Who pushed. A ref carries no pusher, and author and committer are free text.
  - GitHub signs the commits it creates: "GitHub will automatically use GPG to sign commits you make using the web interface". It also signs bot commits made through the API "with no custom author information". So a `web-flow` signature with a bot author proves "made through GitHub's API by an app", which could be any workflow of the repository, not only default-branch CI.
  - Artifact attestations record "the repository, organization, environment, commit SHA, and triggering event". `gh attestation verify --signer-workflow … --source-ref refs/heads/main` enforces the workflow and the ref, but it needs `gh` and GitHub, or a downloaded bundle and `--custom-trusted-root`. The docs also say: "You should **not** sign: Frequent builds that are just for automated testing".
- **What it means** **[inf]**:
  - With no rule on non-branch refs (Q1), the trust boundary is "every account with write access to the repository". That is the group that already pushes branches for pull requests.
  - D6 bounds the harm: the local daemon computes every key, so a forged export can only claim a pass at a true key.
  - In a public repository (cezarion is `PUBLIC`), anyone can read `refs/squeal/*`: check names, durations and closure paths.

## Recommendation for Squeal

1. **Ref**: CI writes `refs/squeal/<main sha>` as a parentless commit whose tree holds the export as it is today (gzipped). Use no notes ref.
2. **Writer**: one small job after the test shards. It has `contents: write` (and `actions: read` when it runs on `push`) and runs no repository code. It writes only for successful runs, then deletes refs beyond the last K in the same push. Start with K = 100 (about two days in cezar), and make K a setting. Whether it runs in the `merge_group` run or on `push` to main is `ci-step`'s question; per-commit refs work for both.
3. **Reader**: the daemon fetches one ref, in the background, at start and when the nearest main ancestor changes. Use the flags of Q3 and a kill timer of a few seconds. A miss or an error only means local runs. Never touch the user's git config or `FETCH_HEAD`, and leave no local ref.
4. **Choice**: nearest first-parent main ancestor of the merge base, one export, refused unless its commit is on the default branch.
5. **Trust**: repository write access, stated in the policy text, with D6 as the bound. Attestations are an opt-in for teams that need provenance; they are not the default, because they need the network and `gh`.

## Open questions for the human

1. Fetching on its own is network I/O that the daemon starts (principle 8). "Import it without a command" was the human's direction. Should the fetch be on by default when the repository has `refs/squeal/*` refs, or need a setting?
2. Is "anyone with write access can write results" acceptable? The only guarded alternative is a branch, which every clone would download unless each clone adds a negative refspec.
3. A later CI row, not run (read-only), on a scratch repository, about 10 runs of 1 to 2 minutes, with the human's approval: whether GitHub accepts `refs/squeal/*` pushes with `GITHUB_TOKEN`; push and fetch times from a laptop; whether GitHub sends thin deltas for a chained ref; when objects of deleted refs disappear; whether a push ruleset path rule covers non-branch refs (private repository needed).

## Sources

- GitHub docs, retrieved 2026-11-09 through `https://docs.github.com/api/article/body?pathname=…`: `/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets`, `…/available-rules-for-rulesets`, `…/creating-rulesets-for-a-repository`; `/en/actions/concepts/security/github_token`; `/en/actions/tutorials/authenticate-with-github_token`; `/en/actions/reference/workflows-and-actions/workflow-syntax` (`permissions`); `/en/actions/reference/workflows-and-actions/events-that-trigger-workflows` (`merge_group`, `push`); `/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue`; `/en/repositories/creating-and-managing-repositories/repository-limits`; `/en/actions/reference/security/secure-use`; `/en/actions/concepts/security/artifact-attestations`; `/en/authentication/managing-commit-signature-verification/about-commit-signature-verification`.
- `https://raw.githubusercontent.com/actions/checkout/main/README.md` and `https://cli.github.com/manual/gh_attestation_verify`, retrieved 2026-11-09.
- git 2.43.0 manual pages (local): `git-fetch` (`--no-write-fetch-head`, `--[no-]auto-maintenance`), `git` (`GIT_TERMINAL_PROMPT`), `git-config` (`http.lowSpeedLimit`, `repack.writeBitmaps`, `gc.pruneExpire`).
- cezarion (read-only): `.github/workflows/ci.yml` at main (`gh api …/contents`); `gh run list --workflow ci.yml --event merge_group` (462 runs) and `--event push`; `gh run view --json jobs` for 42 runs; a treeless clone of `https://github.com/hearsay-tools/cezarion` in `$TMPDIR` (removed); `git worktree list` and `merge-base` in `~/projects/cezar`; trial export of run 42596322864 (`gh run download`, removed after use).
- This repository at `fdb16d0f6`: `spec.md` D2, D6; `research/remote-store.md`; `research/import-trial.md`; `research/main-results.md` (604 files re-keyed per cezar landing).
- Probes: `probes/transport/` and its README (outputs).
