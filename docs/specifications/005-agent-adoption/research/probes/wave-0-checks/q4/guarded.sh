#!/bin/sh
# Throwaway (005-04): the same steps inside main(), called on the last line, reading
# answers only from /dev/tty when there is one.
set -eu
main() {
  echo "step 1: check node"
  echo "step 2: install plugins"
  if [ -t 0 ]; then echo "stdin is a terminal"; else echo "stdin is not a terminal (piped script)"; fi
  if (exec </dev/tty) 2>/dev/null; then echo "/dev/tty is available"; else echo "/dev/tty is not available"; fi
  echo "step 3: copy launcher"
  echo "step 4: print next step"
  echo "DONE guarded"
}
main "$@"
