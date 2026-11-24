#!/bin/sh
# Throwaway (026 agent37-sandboxes). Writes $A37_HOME/ssh_config (temporary key, no
# known_hosts, a ControlMaster socket, the tunnel probe as ProxyCommand) and prints the ssh
# arguments for <id>, one per line. Nothing under the real ~/.ssh is read or written.
ID=$1; USER_=${2:-node}; D=$(cd "$(dirname "$0")" && pwd)
cat > "$A37_HOME/ssh_config" <<C
Host *.agent37.app
  ProxyCommand node $D/tunnel.mjs %h
  IdentityFile $A37_HOME/key
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
  ServerAliveInterval 30
  ControlPath $A37_HOME/cm-%r-%h
  ControlPersist 900
C
printf '%s\n' -F "$A37_HOME/ssh_config" -o ControlMaster=auto "$USER_@$ID.agent37.app"
