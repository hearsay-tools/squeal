#!/bin/sh
# From the agent user: starts the logging proxy as squeal-e2e for one session.
#   proxy-start.sh <name>   (log: dogfood-009/logs/<name>.requests.jsonl)
D=/home/squeal-e2e/dogfood-009
sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e -H sh "$D/scripts/proxy.sh" "$D/logs/$1.requests.jsonl" >/dev/null 2>&1 &
sleep 1
curl -s -o /dev/null -w 'proxy %{http_code}\n' http://127.0.0.1:47319/v1/models
