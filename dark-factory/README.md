# Dark Factory

A task orchestration CLI that breaks architecture documents into dependency-ordered tasks and dispatches Claude AI agents to implement them in parallel, each in its own git worktree.

## How It Works

Dark Factory manages a **job** — a self-contained unit of work defined by architecture documents. A job produces a task graph where each task has dependencies, a complexity rating, and a detailed implementation brief. Tasks are implemented by Claude sub-agents in isolated git worktrees, verified against scaffolded tests, and squash-merged back to an integration branch.

The system is designed for **re-entrant, autonomous execution**. A conductor skill orchestrates the pipeline within a Claude session, and an outer loop restarts the conductor whenever it exits (due to context exhaustion or batch completion) until all tasks are done.

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` on PATH)
- Git

## Installation

```bash
cd dark-factory
bun install
bun link   # makes `dark-factory` available globally
```

## Workflow

### 1. Initialize a Job

From your project root, create a job pointing at one or more architecture documents:

```bash
dark-factory init \
  --name my-feature \
  --architecture docs/ARCHITECTURE.md specs/API_DESIGN.md
```

This creates:
- `jobs/my-feature/job.json` — job configuration
- `jobs/my-feature/task-graph.json` — empty task graph
- `jobs/my-feature/tasks/` — directory for task specs
- A git branch `job/my-feature`

### 2. Extract Tasks

Use Claude to read the architecture docs and produce a structured task list:

```bash
dark-factory extract-tasks --job my-feature
# Or preview first:
dark-factory extract-tasks --job my-feature --dry-run
```

Claude writes a JSON file containing every implementation task with IDs, dependencies, file lists, acceptance criteria, and detailed implementation briefs. These are then written as individual markdown files under `jobs/my-feature/tasks/` and a slim graph in `task-graph.json`.

### 3. Run the Conductor Loop

Switch to the job branch and start the autonomous loop:

```bash
git checkout job/my-feature
./dark-factory/dark-factory-loop.sh
```

The loop script:
1. Detects the active job from the branch name
2. Launches a Claude session that invokes the `conductor` skill
3. After each session exits, checks remaining tasks via `dark-factory status`
4. Restarts the conductor if work remains, or exits when all tasks are complete

### 4. Monitor Progress

In another terminal:

```bash
dark-factory status --job my-feature         # Human-readable summary
dark-factory status --job my-feature --json   # Machine-readable
dark-factory ready --job my-feature           # Tasks ready for work
```

## What the Conductor Does

The conductor skill runs inside each Claude session and follows a 7-step pipeline per task:

| Step | Action |
|------|--------|
| **1. Find ready tasks** | `dark-factory ready --job <job> --json` — tasks with all dependencies satisfied |
| **2. Refine task** | Read task spec, cross-reference with codebase state, update file paths and integration points |
| **3. Scaffold tests** | Create worktree, dispatch sub-agent to write failing tests covering acceptance criteria |
| **4. Implement** | Dispatch worker sub-agent to make the failing tests pass |
| **5. Evaluate** | Verify: tests pass, changes match spec, test integrity preserved (no weakened assertions) |
| **6. Resolve** | Merge worktree on success. On failure: retry (up to 3 attempts) or split into smaller tasks |
| **7. Loop** | Propagate learnings to downstream tasks, check for newly unblocked work, continue |

Key behaviors:
- **Model selection by complexity**: low tasks get Sonnet, medium/high get Opus
- **Workers are isolated**: each sees only its task spec and listed context files, never the full pipeline
- **Re-entrant**: all state is persisted to disk artifacts. If the conductor runs out of context, the outer loop restarts it and it picks up where it left off
- **Test integrity enforcement**: if a worker weakens or removes test assertions to pass, the task fails

## CLI Reference

### Job Lifecycle

| Command | Description |
|---------|-------------|
| `init --name <n> --architecture <paths...>` | Create a new job with scaffolding and git branch |
| `extract-tasks --job <j> [--dry-run]` | Extract tasks from architecture docs via Claude |
| `current-job` | Print the active job name from the current git branch |

### Task Visibility

| Command | Description |
|---------|-------------|
| `status --job <j> [--json]` | Task graph summary (counts by status) |
| `ready --job <j> [--json]` | List tasks with all dependencies satisfied |
| `get --job <j> <task-id>` | Print full task markdown |
| `task-state --job <j> <task-id>` | Derive recovery state from durable artifacts |
| `list --job <j> [--after\|--before <id>] [--json]` | List tasks with transitive dependency filtering |
| `dependents --job <j> <task-id> [--json]` | List tasks that depend on a given task |

### Task Mutations

| Command | Description |
|---------|-------------|
| `set-status --job <j> <task-id> <status>` | Update task status (pending, in-progress, complete, failed, skipped) |
| `add-task --job <j> --title "..." [--deps T001,T002] [--complexity low]` | Add a new task to the graph |
| `add-dep --job <j> <task-id> <dep-id>` | Add a dependency relationship |
| `move-deps --job <j> --from <id> --to <ids>` | Rewire dependencies (e.g., when splitting a failed task) |

### Worktree Management

| Command | Description |
|---------|-------------|
| `worktree create --job <j> <task-id>` | Create isolated worktree + branch `df/<job>/<task-id>` |
| `worktree merge --job <j> <task-id>` | Squash-merge task branch into integration branch |
| `worktree remove --job <j> <task-id>` | Clean up worktree and branch |
| `worktree list --job <j> [--json]` | List active worktrees |

## Project Structure

```
dark-factory/
├── src/
│   ├── cli.ts                    # Entry point, command registration
│   ├── config/
│   │   ├── types.ts              # JobConfig, SlimTask, TaskGraphData interfaces
│   │   ├── job.ts                # Job loading, path resolution
│   │   └── defaults.ts           # Constants (markers, suffixes)
│   ├── core/
│   │   ├── task-graph.ts         # TaskGraph class (in-memory + persistence)
│   │   ├── worktree.ts           # Git worktree operations
│   │   ├── exec.ts               # Subprocess execution
│   │   └── auto-commit.ts        # Git staging + commit helper
│   ├── commands/                  # One file per command
│   │   └── worktree/             # Worktree subcommands
│   └── logging/
│       └── logger.ts             # Timestamped output
├── dark-factory-loop.sh          # Outer conductor loop
├── package.json
└── tsconfig.json
```

## Job Structure on Disk

```
jobs/<job-name>/
├── job.json                      # Static job configuration
├── task-graph.json               # Mutable task status + dependencies
└── tasks/
    ├── T001.md                   # Task specification
    ├── T002.md
    ├── ...
    └── output/
        ├── T001.md               # Worker result report
        └── T002.md
```

## Development

```bash
bun test          # Run tests
bun run typecheck # Type-check
bun run lint      # Lint with Biome
bun run format    # Format with Biome
```
