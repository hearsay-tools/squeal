# Throwaway (row 021-02). Source it: every tool's state lives under $TMPDIR/re.
# HOME, SSH keys, known_hosts and Mutagen's data directory never reach the real HOME.
export RE=$TMPDIR/re
export HOME=$RE/home
export MUTAGEN_DATA_DIRECTORY=$RE/home/mutagen-data
export MUTAGEN_SSH_PATH=$RE/sshwrap
export PATH=$RE/mutagen-bin:$PATH
