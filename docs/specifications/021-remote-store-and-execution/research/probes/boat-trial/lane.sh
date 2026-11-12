# Throwaway: remote lane on|off for the clone, then restart the daemon job and wait until it serves.
cd $T/clone; . $T/env.sh
if [ "$1" = on ]; then cp $T/remote.json.on $XDG_CONFIG_HOME/squeal/remote.json; else rm -f $XDG_CONFIG_HOME/squeal/remote.json; fi
node $T/clone/plugins/claude-code/dist/cli/squeal.mjs stop > /dev/null 2>&1; sleep 2
n=$(grep -c serving $T/daemon.log)
/home/agent/.nvm/versions/node/v26.13.0/bin/node /home/agent/.nvm/versions/node/v26.13.0/lib/node_modules/@hearsay-tools/squawk/dist/index.js job start trial-daemon-$(date +%s) -- $T/daemon.sh > /dev/null 2>&1
while [ $(grep -c serving $T/daemon.log) -le $n ]; do sleep 2; done; tail -1 $T/daemon.log | cut -c1-60
