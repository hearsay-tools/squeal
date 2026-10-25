#!/bin/sh
# Throwaway probe (016-27), question 5: for every worktree of a repository (`git worktree list`), the
# immediate names in each given directory that git ignores (what keying ignored names in a mixed
# directory would add to the key), with each name's birth time. C2's atomic-save temp names
# (`<file>.tmp.<pid>.<random>`) are left out. Reads only. Usage: mixed-names.sh <repo> <dir>...
repo=$1; shift
git -C "$repo" worktree list --porcelain | sed -n 's/^worktree //p' | while read -r wt; do
  for dir in "$@"; do
    [ -d "$wt/$dir" ] || { printf '%s\t%s\tabsent\n' "$(basename "$wt" | cut -c1-8)" "$dir"; continue; }
    names=$(cd "$wt/$dir" && for n in $(ls -A); do
      case "$n" in *.tmp.[0-9]*.*) continue;; esac
      git -C "$wt" check-ignore -q "$dir$n" 2>/dev/null && printf '%s@%s ' "$n" "$(stat -c %w "$n" | cut -c1-16)"
    done)
    printf '%s\t%s\t%s\n' "$(basename "$wt" | cut -c1-8)" "$dir" "${names:-none}"
  done
done
