# Brief: issue 9 (recovered from the triage branch's research/README.md addition, cez/bff55c84)

## Topic: issue-9-git-identity
Use /researcher. Shape: research. Review https://github.com/hearsay-tools/squeal/issues/9 and its comments, spec D2/D7 and status amendments for 001-406, and board rows 001-24, 001-43, 001-406. Outcome: establish whether committing validated bytes without another file revision produces contradictory status Git identities. Starting seam: status rendering and its Git identity reader; first inspect the top-level versus commit identity sources.
1. Reproduce with installed 0.1.199 in a disposable Git fixture with a minimal Vitest test (reuse repository dependencies), clean start, validated edit, commit, text and JSON status, Git HEAD and porcelain. Record exact commands, output, version and whether the revision changed. Stop the fixture daemon and remove temporary resources. No product fixes.
2. Identify existing row overlap and whether issue/comment adds new information; distinguish experimental evidence from source reading and unverified claims.
3. Assess alignment with vision provenance, honest state and reduced blocking.
Own only `research/issue-9-git-identity.md` and optional throwaway probe under `research/probes/issue-9-git-identity/`. Do not edit board, spec, status or product. Done when the report records reproduction path/results (or explicit inability), overlap and human decision recommendation. Commit the report. Do not run the repository full suite for this research-only task.
