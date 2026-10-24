# Throwaway: source list for harness-landscape (brief 016-04)

THROWAWAY. Not product code; nothing imports it. It records how the sources behind `../../harness-landscape.md` were fetched on 2026-10-24.

No experiment was run. The brief forbids running or installing any harness, so every finding is read in docs or source.

- `fetch.py <url> <out.txt>` downloads one docs page and strips its HTML to text. It was used for the Cursor, Amp, Kiro, Windsurf, Factory Droid, Agent Plugins and AGENTS.md pages. GitHub Docs pages were fetched as Markdown through `https://docs.github.com/api/article/body?pathname=<path>`. The Claude Code pages were fetched as `<page>.md`.
- Repositories were shallow-cloned (`git clone --depth 1`) into a scratch directory under `/tmp`, read, and removed. The revisions are listed in the findings' Sources.
- Nothing ran as a daemon, and nothing touched a Squeal store or the real `HOME`.
