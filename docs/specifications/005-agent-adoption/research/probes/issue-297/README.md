# Issue 297 throwaway probe

These read-only network commands test access without inherited environment or git credentials. Run from an empty temporary directory outside a repository for an independent repeat. No install, test suite or harness hook is run.

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
env -i PATH=/usr/bin:/bin /usr/bin/curl -q -sS -o /dev/null -w 'clean anonymous marketplace HTTP %{http_code}\n' --max-time 20 https://api.github.com/repos/hearsay-tools/marketplace
env -i PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false /usr/bin/git -c credential.helper= -c core.askPass=/bin/false ls-remote https://github.com/hearsay-tools/marketplace.git HEAD
env -i PATH=/usr/bin:/bin /usr/bin/curl -q -fsSL --max-time 20 https://github.com/hearsay-tools/squeal/releases/download/squeal--v0.1.654/squeal-codex-runtime.json
```

The version command runs at the repository root; the network commands above were run there too. They do not write files. The credentials-disabled git command failed before fetching refs.
