# Probe: cezar-posttooluse (throwaway)

No files. The only probe was one command, run from an empty directory under /tmp:

    node --disable-warning=ExperimentalWarning \
      /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.341/dist/post-tool-use.mjs </dev/null

The path no longer exists, so Node loads no hook code. Output began
`node:internal/modules/cjs/loader:1568 throw err;` and the exit code was 1.
