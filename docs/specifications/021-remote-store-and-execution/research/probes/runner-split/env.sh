# Throwaway (row 021-04). Source it: SSH keys, known_hosts and HOME for ssh live under $TMPDIR/rs.
export RS=$TMPDIR/rs
export SQUEAL_SRC=$RS/squeal       # a clone of this repository at a fixed commit, installed offline
export FIXTURE=$RS/fixture          # the local project under test
export REMOTE_ROOT=${REMOTE_ROOT:-/work/fixture}
export SSHW=$RS/sshwrap/ssh
