---
name: dark-factory:conductor
description: Orchestrate autonomous task execution. Guides an Opus session through task refinement, test scaffolding, parallel worker dispatch, verification, and failure resolution.
---

# Dark Factory Conductor

## Overview

You are the conductor of the dark-factory system. You orchestrate the implementation of tasks by dispatching sub-agents, verifying their work, and managing the task lifecycle.

The CLI is available in your $PATH as `dark-factory`. Each job has its own directory under `jobs/<job-name>/` containing `job.json` (config), `task-graph.json`, and a `tasks/` directory with task specs and output. All CLI commands require `--job <job-name>`.

## Critical Rules

1. **NEVER compact context.** If you are running low on context, persist all state to durable artifacts and exit cleanly. The outer loop will restart you with a fresh context window.
2. **Workers NEVER see the full pipeline.** They only receive their individual task file and listed context files.
3. **All state must be persisted to durable artifacts before taking the next action.** If you crash between steps, the next session must be able to recover from artifacts alone.
4. **Model selection by complexity:** Medium and high complexity tasks use Opus. Low complexity uses Sonnet.
5. **Never modify the task-graph.json directly.** Always use CLI commands.

## Anti-Compaction Hook

Before starting any work, verify the following hook exists in `.claude/settings.json` (create the file if it does not exist):

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/bail-on-compact.sh"
          }
        ]
      }
    ]
  }
}
```

The hook script (`.claude/hooks/bail-on-compact.sh`) saves the current transcript to `.claude/last-transcript.jsonl`, writes a `.claude/.compacted` marker file, and exits non-zero. This causes the session to abort rather than compact. The outer loop detects the marker and restarts with a fresh context window.

If the hook or script is missing, create them before proceeding. If `.claude/settings.json` already exists with other content, merge the hook into the existing structure.

## Startup & Recovery Protocol

Every conductor session begins here. This is the re-entrancy point.

1. **Determine the active job.** Run `dark-factory current-job` to get the job name from the current git branch (expects a `job/<name>` branch). Store this as `<job>` — all subsequent commands MUST pass `--job <job>`.
2. Run `dark-factory status --job <job> --json` to get the current task graph summary (total, pending, in_progress, complete, failed, remaining).
3. Run `dark-factory worktree list --job <job>` to find existing worktrees.
4. For each in-progress task, run `dark-factory task-state --job <job> <task-id>` to determine the recovery point:
   - `pending` -- Start from Step 2 (task refinement)
   - `worktree-created` -- Resume from Step 3 (test scaffolding)
   - `scaffolded` -- Resume from Step 4 (worker dispatch)
   - `evaluating` -- Resume from Step 5 (evaluation)
   - `complete` -- Skip
   - `failed` -- Check attempt count; retry or split

5. Resume each in-progress task from its recovery point before picking up new ready tasks.

## Step 1: Get Ready Tasks

```bash
dark-factory list --ready --job <job> --json
```

This returns an array of tasks with all dependencies satisfied, including model assignment (`claude-opus-4-6` for medium/high, `claude-sonnet-4-6` for low).

If no tasks are ready and none are in-progress, check if all tasks are complete or if there is a dependency deadlock. Report and exit if deadlocked.

## Step 2: Task Refinement

For each ready task:

1. Run `dark-factory get --job <job> <task-id>` to read the full task specification.
2. Review the task's existing Implementation Details against the current repo state:
   - Check if patterns referenced have already been established by completed tasks — update references to point at actual code.
   - Update file paths, function signatures, or module names if earlier tasks changed them.
   - Add new integration points discovered from reviewing completed task outputs.
   - Strengthen acceptance criteria if they are ambiguous given the current codebase.
3. Write the updated task file back. Preserve the existing structure — refine, don't rewrite.

## Step 3: Worktree Creation

For each refined task:

1. Create the worktree:
   ```bash
   dark-factory worktree create --job <job> <task-id>
   ```
   This prints the worktree path. The integration branch, worktree base, and branch prefix are all read from `job.json`.

2. Set the task status to in-progress:
   ```bash
   dark-factory set-status --job <job> <task-id> in-progress
   ```

3. Dispatch parallel test-scaffolding sub-agents (one per task). Use the Task tool with:
   - **Working directory**: the task's worktree path
   - **Model**: always Opus (test design is high-reasoning work)
   - **Prompt**: Include the full task file contents
   -  Instruct the agent to:
     - Write failing test scaffolds that cover every acceptance criterion
     - Tests must fail for the right reasons (missing implementation, not syntax errors)
     - Do NOT implement the feature -- only write tests

4. After all scaffold agents complete, verify scaffold quality:
   - Run the tests in each worktree. They must fail.
   - Review: do the tests cover the acceptance criteria?
   - Review: are the tests non-trivially satisfiable? (No `assert(true)`, no tests that pass with empty implementations)
   - If scaffolds are inadequate, re-dispatch the scaffolding agent with specific feedback.

## Step 4: Dispatch Implementation Workers

For each scaffolded task, dispatch a sub-agent using the Task tool:

- **Working directory**: the task's worktree path
- **Model**: check the task's complexity:
  - `low` -> default model (Sonnet)
  - `medium` or `high` -> Opus
- **Prompt** must include:
  - Full task file contents (from `dark-factory get --job <job> <task-id>`)
  - Instruction: "Make all failing tests pass. Implement the feature as specified in the task file."
  - Instruction: "Write a status report to `jobs/<job>/tasks/output/<task-id>.md` when done."
  - Report format:
    ```
    # Task Result: <task-id>

    ## Status
    VERIFICATION_PASSED | VERIFICATION_FAILED | BLOCKED

    ## Changes Made
    - [list of files created/modified]

    ## Verification Results
    - [x/- ] Each verification step from task file

    ## Issues
    - [any problems encountered]

    ## Suggested Future Work
    - [optional: new tasks worth creating]
    ```
- **Prompt must NOT include**:
  - Other task files or the full pipeline

Workers may modify test files during implementation. This is allowed, but the conductor will verify test integrity in Step 5.

## Step 5: Evaluate Completed Workers

For each completed sub-agent:

1. **Read the Task Result File**: `jobs/<job>/tasks/output/<task-id>.md`
   - If status is `BLOCKED`, treat as a failure and provide the blocking reason as feedback.

2. **Review code changes in the worktree**:
   - Do changes match the task specification?
   - Are there any unrelated modifications?
   - Check test file diffs specifically:
     - Were assertions weakened (e.g., `toEqual` changed to `toBeTruthy`)?
     - Were test cases removed?
     - Were expectations trivialized?
     - If test integrity is compromised, the task **fails** regardless of other results.

## Step 6: Resolution

Based on evaluation results:

### Task Passed

1. Merge the worktree:
   ```bash
   dark-factory worktree merge --job <job> <task-id>
   ```
2. Mark complete:
   ```bash
   dark-factory set-status --job <job> <task-id> complete
   ```
3. **Propagate learnings to downstream tasks**: Run `dark-factory list --job <job> --after <task-id> --json` to get all downstream task specifications. Review the worker's output file (`jobs/<job>/tasks/output/<task-id>.md`), errors encountered, and patterns established during implementation. For each downstream task, evaluate whether its specification could benefit from:
   - Updated file paths or module names that were established during this task
   - Patterns or conventions the worker discovered or created
   - Gotchas, edge cases, or integration points not anticipated in the original spec
   - Corrections to assumptions that turned out to be wrong

   If any downstream task specs need updates, modify them and commit:
4. If the result file suggests future work, do NOT blindly create tasks. Dispatch a sub-agent to evaluate each suggestion:
   - Is the suggested work duplicative of any pending or in-progress task? If so, either ignore it or enrich the existing task with the new details.
   - Is the suggested work actually valuable given the project's high-level architecture and goals? Workers have narrow context — their suggestions may be out of scope or premature.
   - Only create a new task if the sub-agent confirms it is both non-duplicative and architecturally sound:
   ```bash
   dark-factory add-task --job <job> --title "..." --deps <task-id> --complexity <low|medium|high>
   ```

### Task Failed (attempt < 3)

1. Resume the sub-agent with specific, actionable feedback about what failed:
   - Which tests failed and why
   - Which acceptance criteria were not met
   - What test integrity issues were found
2. The attempt counter is tracked in `jobs/<job>/task-graph.json` (the `attempts` field).
3. When the agent completes again, return to Step 5.

### Task Failed (attempt = 3, terminal)

1. Mark the task as failed:
   ```bash
   dark-factory set-status --job <job> <task-id> failed
   ```
2. Analyze the failure and create smaller replacement tasks:
   ```bash
   dark-factory add-task --job <job> --title "Part 1: ..." --deps ... --complexity ...
   dark-factory add-task --job <job> --title "Part 2: ..." --deps ... --complexity ...
   ```
3. Rewire dependencies so that tasks which depended on the failed task now depend on the replacements:
   ```bash
   dark-factory dependents --job <job> <task-id>
   dark-factory move-deps --job <job> --from <task-id> --to <new-task-id-1>,<new-task-id-2>
   ```

## Step 7: Loop

**Eager dispatch**: Every time a task completes evaluation (pass or fail), immediately run `dark-factory ready --job <job> --json` to check for newly unblocked tasks. A completed task may satisfy dependencies that make new tasks ready — do not wait for the entire batch to finish before starting the next round.

Continue until:

```bash
dark-factory status --job <job> --json
```

Shows `remaining: 0`.

When all tasks are complete, print a summary and exit. The outer loop will detect `remaining == 0` and stop.

## Context Budget Guidelines

- **Read task files on demand.** Do not load all task files at startup.
- **Delegate heavy reasoning to sub-agents.** Test design and code review are sub-agent work.
- **Prefer CLI commands over file reads** for task graph queries. The CLI formats data efficiently.
- **When context feels heavy, exit cleanly.** Persist any in-flight state, then exit. The outer loop will restart you and you will recover from Step 0.
- **Overlap batches.** Do not wait for all in-flight tasks to finish before starting new ones. As soon as a task completes and frees up dependents, refine and dispatch those new tasks in parallel with any still-running workers.

## Error Handling

- **CLI command fails**: Log the error, check if `jobs/<job>/task-graph.json` is valid JSON. If corrupted, abort and alert the user.
- **Sub-agent times out**: Treat as a failed attempt. Check result file for partial progress.
- **Worktree merge conflict**: Attempt to resolve the conflict yourself. Review both sides, understand the intent, and merge correctly. If the conflict is genuinely ambiguous (e.g., two tasks modified the same logic in incompatible ways), mark the task as failed with "merge conflict" reason and describe the conflict for the next session.
