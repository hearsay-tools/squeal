# Final compatibility and test-delta review

Use /reviewer on the exact candidate SHA supplied at dispatch. Own only reviews/0.1.368-final.md. Prior reviews/0.1.368-r2.md passed B1/B2; do not reopen settled scope unless this delta does.

Review approved spec015 row015-95, its notes and source-map research. Verify payload-only inline parsing, strict original-text/source identity, malformed/unsupported evidence as unread, bounded decoding/mapping, direct and actual-worker paths, provider3 invalidation and unchanged recorder child exclusion. Inspect valid parsed-map and plain-source compatibility. Check captured Node24.22.1 reproduction and Node22/24 evidence; discriminate any concern with focused checks.

Review test-only changes after9401c1d08: dispatch busy/no-pin/retry assertions (002-41), packaging warning flag matching production, and explicit plain-shell env in four CLI stop fixtures. Preserve successful pin/current invariants and original output assertions.

Adapter1.0.2 deliberately refreshes the unpublished seed with the coverage fix. Runtime/seed remain0.1.368 and must be byte-identical. Verify generated output, semantic key/version gates, ordinary-build immutability and later-runtime proof with the frozen seed. Scratch homes only, no production trust writes or inference.

Use Squeal affected checks and explicit excluded e2e as needed. No full local suite or checkpoint. Read exact-candidate CI; pending/red CI is not a pass. Commit findings with proven blockers separate from unverified concerns and actual verification limits. Parent owns release.
