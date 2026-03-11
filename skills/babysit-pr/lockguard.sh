#!/usr/bin/env bash
# Concurrency guard for babysit-pr skill.
# Usage: source lockguard.sh [acquire|release]
# - acquire: Check/acquire lock. Exits 0 if acquired, exits 1 if another iteration is running.
# - release: Remove the lockfile.

BRANCH=$(git branch --show-current)
LOCKFILE="/tmp/babysit-pr-${BRANCH}.lock"

case "${1:-acquire}" in
  acquire)
    if [ -f "$LOCKFILE" ]; then
      PID=$(cat "$LOCKFILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo "Another babysit-pr iteration is running (PID $PID). Exiting."
        exit 1
      fi
      rm -f "$LOCKFILE"
    fi
    echo $$ > "$LOCKFILE"
    trap "rm -f '$LOCKFILE'" EXIT
    echo "Lock acquired."
    ;;
  release)
    rm -f "$LOCKFILE"
    echo "Lock released."
    ;;
esac
