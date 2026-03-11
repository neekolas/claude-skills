# Babysit PR Skill Design

## Summary

A stateless skill invoked via `/loop 5m /babysit-pr` that monitors a PR's CI checks and review comments, fixes issues autonomously, and exits when the PR is clean. Maximum loop time is 1 hour. Each invocation processes all outstanding issues, verifies fixes locally before pushing, and uses a lockfile to prevent concurrent iterations from clobbering each other.

## Goals

- Autonomously resolve CI failures caused by the PR's changes
- Respond to and resolve all PR review comments appropriately
- Push verified fixes via Graphite (`gt modify --commit` + `gt submit`)
- Exit cleanly when all required checks pass and all threads are resolved

## Non-Goals

- Managing PR creation or initial submission
- Handling non-required CI checks
- Making architectural changes beyond what's needed to fix identified issues
- Rebasing or stack management

## Invocation

```bash
/loop 5m /babysit-pr
```

The skill is designed for `/loop` — each invocation is stateless and idempotent. The `/loop` command handles recurrence every 5 minutes for up to 1 hour.

## PR Discovery

The skill operates on the PR associated with the current branch. Determined via `gh pr view --json number,url` from the current branch. If no PR exists for the current branch, exit with an error message.

## Iteration Flow

Each invocation follows this sequence:

1. **Concurrency check** — Check for lockfile at `/tmp/babysit-pr-<branch>.lock`. If present and the creating process is still running (check PID with `kill -0`), exit immediately. If the PID is dead, clean up the stale lock and proceed.
2. **Acquire lock** — Create lockfile containing `$$` (current shell PID).
3. **Check CI statuses** — Use `gh pr checks --json name,state,bucket,required`. Only act on checks for the HEAD commit (`gh pr view --json commits` to verify). If checks are pending/in-progress, skip CI fixes this iteration and wait for results.
   For each failing check (required and optional):
   - Get failure logs via `gh run view <id> --log-failed`
   - Investigate the failure and identify root cause
   - Fix the issue in code
4. **Process all unresolved review comments** — Query review threads via `gh api graphql`. Skip any thread where the last reply is from the babysitter (already responded). For each unresolved thread, classify and act:
   - **Real issue** (bug, correctness, missing edge case) → Fix the code, reply describing the fix, resolve thread
   - **Scope-changing suggestion** (feature request, style preference) → Reply explaining it's out of scope for this PR. Do NOT resolve — leave for reviewer to resolve.
   - **Non-issue** (misunderstanding, already handled) → Reply explaining why it's not an issue. Do NOT resolve — leave for reviewer to resolve.
5. **If any code changes were made:**
   - Run local verification (test/lint/typecheck commands as specified in the project's CLAUDE.md or AGENTS.md)
   - If verification passes: `gt modify --commit` + `gt submit`
   - If verification fails: Do not push. Log the failure and move on — next iteration will retry.
6. **Evaluate exit condition:**
   - All required checks passing on HEAD AND no unresolved review threads with un-replied comments → Print: "All required checks passing and all review comments addressed. PR is ready — you can stop the loop."
   - Otherwise → Print summary of remaining issues
7. **Release lock** — Remove lockfile (always, even on error — use trap).

## Comment Classification

All replies identify as AI-assisted (e.g., "🤖 [response]").

| Type | Signals | Action |
|------|---------|--------|
| Real issue | Bug, correctness problem, missing edge case, security concern | Fix code, reply with description of fix, resolve thread |
| Scope change | "Could you also...", style preference not in linter, feature suggestion, behavioral change | Reply: out of scope for this PR. Leave thread open. |
| Non-issue | Misunderstanding of intent, already handled elsewhere, factually incorrect feedback | Reply with explanation. Leave thread open. |

## Exit Condition

The exit condition accounts for threads the skill has replied to but intentionally left open:

- All **required** CI checks are passing on the HEAD commit
- All review threads are either: resolved, OR have a reply from the babysitter as the last comment (meaning the skill has addressed it — the reviewer may or may not resolve it)
- No new unaddressed review comments

Optional check failures do not block the exit condition. The skill attempts to fix them but notes any remaining optional failures in the output.

The skill prints a clear "PR is ready" message. The user manually stops the `/loop` or it times out at 1 hour.

## Safety Mechanisms

### Concurrency Guard

Lockfile at `/tmp/babysit-pr-<branch>.lock` prevents overlapping iterations. PID-based staleness detection allows recovery from crashed iterations. Lock is always released via `trap` on exit.

### Local Verification Before Push

After making fixes, run the project's local verification commands (test, lint, typecheck) as specified in the project's CLAUDE.md or AGENTS.md before pushing.

### Commit Strategy

All fixes within a single iteration are committed together using `gt modify --commit`, then pushed via `gt submit`. This amends onto the existing branch commit rather than creating fix-up commits.

## Dependencies

- **`/loop` command** — Handles recurrence scheduling
- **`working-with-graphite` skill** — Used for commit and push operations
- **`gh` CLI** — PR checks, review comments, API calls
- **Project-local tooling** — Test runner, linter, type checker for local verification
