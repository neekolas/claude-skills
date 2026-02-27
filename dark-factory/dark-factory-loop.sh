#!/bin/bash
set -euo pipefail

MAX_SESSIONS="${1:-5}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Dark Factory Conductor Loop ==="
echo "Project root: $PROJECT_ROOT"
echo "Max sessions: $MAX_SESSIONS"
echo "Press Ctrl+C to stop."
echo ""

# Determine the active job from the current branch
CURRENT_BRANCH="$(git -C "$PROJECT_ROOT" branch --show-current)"
JOB_NAME="${CURRENT_BRANCH#job/}"

if [ "$JOB_NAME" = "$CURRENT_BRANCH" ]; then
  echo "ERROR: Not on a job branch. Expected branch matching 'job/<name>'."
  echo "Current branch: $CURRENT_BRANCH"
  echo "Run 'dark-factory init <name>' first."
  exit 1
fi

echo "Job: $JOB_NAME (branch: $CURRENT_BRANCH)"

# Verify job directory exists
if [ ! -f "$PROJECT_ROOT/jobs/$JOB_NAME/job.json" ]; then
  echo "ERROR: jobs/$JOB_NAME/job.json not found."
  echo "Run 'dark-factory init $JOB_NAME' first."
  exit 1
fi

SESSION_COUNT=0
CLAUDE_PID=""

# Forward signals to the running claude process
cleanup() {
  if [ -n "$CLAUDE_PID" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then
    kill -INT "$CLAUDE_PID" 2>/dev/null
    wait "$CLAUDE_PID" 2>/dev/null
  fi
  echo ""
  echo "=== Interrupted. Total conductor sessions: $SESSION_COUNT ==="
  exit 130
}
trap cleanup INT TERM

for i in $(seq 1 "$MAX_SESSIONS"); do
  SESSION_COUNT=$i
  rm -f "$PROJECT_ROOT/.claude/.compacted"

  echo "=== Conductor session #$i/$MAX_SESSIONS ==="
  echo ""

  # Run the conductor interactively. It will exit when:
  # - PreCompact hook fires (context exhaustion) → .compacted marker created
  # - All tasks complete → Claude exits normally
  # - Unexpected error
  cd "$PROJECT_ROOT"
  claude --model claude-opus-4-6 --dangerously-skip-permissions \
    "Invoke the dark-factory:conductor skill and begin orchestration." &
  CLAUDE_PID=$!
  wait "$CLAUDE_PID" || true
  CLAUDE_PID=""

  # Check why Claude exited
  if [ -f "$PROJECT_ROOT/.claude/.compacted" ]; then
    echo ""
    echo "Compaction detected, restarting with fresh context..."
    echo ""
    continue
  fi

  # No compaction — check if all work is done
  REMAINING=$(dark-factory status --job "$JOB_NAME" --json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('remaining',1))" 2>/dev/null \
    || echo "1")

  if [ "$REMAINING" = "0" ]; then
    echo ""
    echo "=== All tasks complete! ==="
    echo "Total conductor sessions: $SESSION_COUNT"
    exit 0
  fi

  echo ""
  echo "Conductor session #$i ended. $REMAINING task(s) remaining."
  echo ""
done

echo "=== Max sessions reached ($MAX_SESSIONS). Stopping. ==="
