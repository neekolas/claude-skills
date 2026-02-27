# List Command Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the `list` command with composable `--ready`, `--status`, and `--include-content` filter flags, then delete the now-redundant `ready` command.

**Architecture:** Sequential filter pipeline — collect base task set, apply filters, format output. Extract a shared `modelForComplexity` helper to DRY up the model assignment logic used in `task-graph.ts`, `status.ts`, and now `list.ts`. Add a `ListTask` type for the output shape. Add a `readyTaskIds()` method to `TaskGraph` to make the ready check reusable as a filter without duplicating logic.

**Tech Stack:** TypeScript, Bun, Commander.js, bun:test

---

### Task 1: Extract `modelForComplexity` helper

**Files:**
- Create: `src/core/model.ts`
- Test: `src/core/model.test.ts`
- Modify: `src/core/task-graph.ts:66` (use helper)
- Modify: `src/commands/status.ts:41` (use helper)

**Step 1: Write the failing test**

Create `src/core/model.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { modelForComplexity } from "./model.js";

describe("modelForComplexity", () => {
	test("low complexity returns sonnet", () => {
		expect(modelForComplexity("low")).toBe("claude-sonnet-4-6");
	});

	test("medium complexity returns opus", () => {
		expect(modelForComplexity("medium")).toBe("claude-opus-4-6");
	});

	test("high complexity returns opus", () => {
		expect(modelForComplexity("high")).toBe("claude-opus-4-6");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd dark-factory && bun test src/core/model.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/core/model.ts`:

```typescript
import type { Complexity } from "../config/types.js";

export function modelForComplexity(complexity: Complexity): string {
	return complexity === "low" ? "claude-sonnet-4-6" : "claude-opus-4-6";
}
```

**Step 4: Run test to verify it passes**

Run: `cd dark-factory && bun test src/core/model.test.ts`
Expected: PASS

**Step 5: Wire up existing callers**

In `src/core/task-graph.ts`, add import and replace line 66:

```typescript
// Add to imports:
import { modelForComplexity } from "./model.js";

// Replace line 66:
// OLD: const model = task.complexity === "low" ? "claude-sonnet-4-6" : "claude-opus-4-6";
// NEW:
const model = modelForComplexity(task.complexity);
```

In `src/commands/status.ts`, add import and replace line 41:

```typescript
// Add to imports:
import { modelForComplexity } from "../core/model.js";

// Replace line 41:
// OLD: const model = task.complexity === "low" ? "sonnet" : "opus";
// NEW:
const model = modelForComplexity(task.complexity);
```

Note: `status.ts` currently uses short names ("sonnet"/"opus"). After this change it will use full model IDs. Check if the status command output format needs adjustment — the output format on line ~42 uses `model` directly in a display string, so update the display format accordingly if needed.

**Step 6: Run all tests to verify nothing broke**

Run: `cd dark-factory && bun test`
Expected: All existing tests pass

**Step 7: Commit**

```
feat: extract modelForComplexity helper
```

---

### Task 2: Add `readyTaskIds()` method to `TaskGraph`

**Files:**
- Test: `src/core/task-graph.test.ts` (add test)
- Modify: `src/core/task-graph.ts` (add method)

**Step 1: Write the failing test**

Add to `src/core/task-graph.test.ts` (inside existing describe block or new one):

```typescript
test("readyTaskIds returns IDs of tasks that are ready", async () => {
	// Using existing fixture with T001=complete, T002=pending(deps:T001), T003=pending(deps:T002), T004=pending(deps:[])
	const ids = tg.readyTaskIds();
	expect(ids).toEqual(["T002", "T004"]);
});
```

Note: Check the existing test file's fixture and `tg` variable name. The test should use whatever setup the file already has. If the fixture doesn't have the right shape, create a local fixture for this test.

**Step 2: Run test to verify it fails**

Run: `cd dark-factory && bun test src/core/task-graph.test.ts`
Expected: FAIL — `readyTaskIds` is not a function

**Step 3: Write minimal implementation**

In `src/core/task-graph.ts`, add method (after `readyTasks()`):

```typescript
readyTaskIds(): Set<string> {
	const terminalIds = new Set<string>();
	for (const [id, task] of Object.entries(this.data.tasks)) {
		if (TERMINAL_STATUSES.includes(task.status)) {
			terminalIds.add(id);
		}
	}

	const ready = new Set<string>();
	for (const [id, task] of Object.entries(this.data.tasks)) {
		if (task.status !== "pending") continue;
		if (!task.dependencies.every((dep) => terminalIds.has(dep))) continue;
		ready.add(id);
	}
	return ready;
}
```

**Step 4: Refactor `readyTasks()` to use `readyTaskIds()`**

```typescript
readyTasks(): ReadyTask[] {
	const readyIds = this.readyTaskIds();
	const ready: ReadyTask[] = [];
	for (const id of readyIds) {
		const task = this.data.tasks[id]!;
		ready.push({
			id,
			title: task.title,
			complexity: task.complexity,
			model: modelForComplexity(task.complexity),
			file: task.file,
		});
	}
	return ready.sort((a, b) => a.id.localeCompare(b.id));
}
```

**Step 5: Run all tests**

Run: `cd dark-factory && bun test`
Expected: All pass (including existing ready command tests)

**Step 6: Commit**

```
feat: add readyTaskIds() to TaskGraph
```

---

### Task 3: Add `ListTask` type

**Files:**
- Modify: `src/config/types.ts`

**Step 1: Add the type**

Add to `src/config/types.ts`:

```typescript
// Output shape for list command
export interface ListTask {
	id: string;
	title: string;
	status: TaskStatus;
	complexity: Complexity;
	model: string;
	dependencies: string[];
	content?: string;
}
```

**Step 2: Commit**

```
feat: add ListTask type
```

---

### Task 4: Rewrite `list` command with filter pipeline

**Files:**
- Modify: `src/commands/list.ts` (full rewrite)

**Step 1: Rewrite `src/commands/list.ts`**

```typescript
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import type { ListTask, TaskStatus } from "../config/types.js";
import { modelForComplexity } from "../core/model.js";
import { TaskGraph } from "../core/task-graph.js";

export const listCommand = new Command("list")
	.description("List tasks with composable filters")
	.option("--after <task-id>", "Scope to tasks that transitively depend on this task")
	.option("--before <task-id>", "Scope to tasks this task transitively depends on")
	.option("--ready", "Filter to only tasks ready for work")
	.option("--status <statuses>", "Filter by status (comma-separated)")
	.option("--include-content", "Include markdown file content in output")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.option("--json", "Output as JSON")
	.action(async (opts) => {
		if (opts.after && opts.before) {
			console.error("--after and --before are mutually exclusive");
			process.exit(1);
		}

		const projectRoot = resolve(opts.projectRoot);
		const { paths } = await requireJobOption(opts.job, projectRoot);
		const tg = await TaskGraph.load(paths.taskGraph);

		// 1. Base set: scoped by --after/--before, or all tasks
		let taskIds: string[];
		if (opts.after) {
			taskIds = tg.transitiveDownstream(opts.after);
		} else if (opts.before) {
			taskIds = tg.transitiveUpstream(opts.before);
		} else {
			taskIds = tg.allTaskIds();
		}

		// 2. Filter by --status
		if (opts.status) {
			const statuses = new Set(opts.status.split(",") as TaskStatus[]);
			taskIds = taskIds.filter((id) => {
				const task = tg.getTask(id);
				return task && statuses.has(task.status);
			});
		}

		// 3. Filter by --ready
		if (opts.ready) {
			const readyIds = tg.readyTaskIds();
			taskIds = taskIds.filter((id) => readyIds.has(id));
		}

		// 4. Build results
		const results: ListTask[] = [];
		for (const id of taskIds) {
			const task = tg.getTask(id);
			if (!task) continue;

			const entry: ListTask = {
				id,
				title: task.title,
				status: task.status,
				complexity: task.complexity,
				model: modelForComplexity(task.complexity),
				dependencies: task.dependencies,
			};

			if (opts.includeContent) {
				try {
					entry.content = await readFile(join(projectRoot, task.file), "utf-8");
				} catch {
					entry.content = `[File not found: ${task.file}]`;
				}
			}

			results.push(entry);
		}

		// 5. Output
		if (opts.json) {
			console.log(JSON.stringify(results, null, 2));
			return;
		}

		if (results.length === 0) {
			console.log("No tasks match the given filters.");
			return;
		}

		if (opts.includeContent) {
			for (const r of results) {
				console.log(`--- ${r.id}: ${r.title} [${r.status}] ---`);
				console.log(r.content);
				console.log();
			}
		} else {
			console.log(`${results.length} task(s):\n`);
			for (const r of results) {
				console.log(`  ${r.id}: ${r.title} [${r.status}] (${r.complexity} → ${r.model})`);
			}
		}
	});
```

**Step 2: Verify it compiles**

Run: `cd dark-factory && bun build src/commands/list.ts --no-bundle 2>&1 | head -5`
Expected: No type errors

**Step 3: Commit**

```
feat: rewrite list command with composable filter flags
```

---

### Task 5: Write `list` command tests

**Files:**
- Create: `src/commands/list.test.ts`

**Step 1: Write the test file**

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobConfig, TaskGraphData } from "../config/types.js";

// T001: complete, no deps
// T002: pending, deps [T001] → ready, medium
// T003: pending, deps [T002] → blocked, high
// T004: pending, no deps → ready, low
// T005: failed, no deps
const FIXTURE: TaskGraphData = {
	project: "test-list-project",
	tasks: {
		T001: {
			title: "Init workspace",
			status: "complete",
			dependencies: [],
			file: "jobs/test/tasks/T001.md",
			complexity: "low",
			attempts: 1,
		},
		T002: {
			title: "Build foundation",
			status: "pending",
			dependencies: ["T001"],
			file: "jobs/test/tasks/T002.md",
			complexity: "medium",
			attempts: 0,
		},
		T003: {
			title: "Implement feature",
			status: "pending",
			dependencies: ["T002"],
			file: "jobs/test/tasks/T003.md",
			complexity: "high",
			attempts: 0,
		},
		T004: {
			title: "Independent task",
			status: "pending",
			dependencies: [],
			file: "jobs/test/tasks/T004.md",
			complexity: "low",
			attempts: 0,
		},
		T005: {
			title: "Broken task",
			status: "failed",
			dependencies: [],
			file: "jobs/test/tasks/T005.md",
			complexity: "low",
			attempts: 2,
		},
	},
};

const JOB_CONFIG: JobConfig = {
	name: "test",
	architecture_files: [],
	task_graph: "jobs/test/task-graph.json",
	tasks_dir: "jobs/test/tasks",
	output_dir: "jobs/test/tasks/output",
	integration_branch: "develop",
	worktree_base: "../.df-worktrees",
	branch_prefix: "df/test/",
	model: "claude-opus-4-6",
	created_at: "2026-01-01T00:00:00Z",
};

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-list-test-"));
	const jobDir = join(tmpDir, "jobs", "test");
	const tasksDir = join(tmpDir, "jobs", "test", "tasks");
	await mkdir(tasksDir, { recursive: true });
	await Bun.write(join(jobDir, "job.json"), JSON.stringify(JOB_CONFIG, null, 2));
	await Bun.write(join(jobDir, "task-graph.json"), JSON.stringify(FIXTURE, null, 2));

	// Write markdown content for tasks
	for (const [id, task] of Object.entries(FIXTURE.tasks)) {
		await writeFile(
			join(tmpDir, task.file),
			`# ${id}: ${task.title}\n\nTask description for ${id}.\n`,
		);
	}
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function runList(args: string[]): Promise<string> {
	const { listCommand } = await import("./list.js");
	const lines: string[] = [];
	const origLog = console.log;
	console.log = (...a: unknown[]) => lines.push(a.join(" "));
	try {
		await listCommand.parseAsync(["node", "list", ...args]);
	} finally {
		console.log = origLog;
	}
	return lines.join("\n");
}

describe("list command", () => {
	test("no filters lists all tasks", async () => {
		const output = await runList(["--job", "test", "--project-root", tmpDir, "--json"]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(5);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T001", "T002", "T003", "T004", "T005"]);
	});

	test("model is always present", async () => {
		const output = await runList(["--job", "test", "--project-root", tmpDir, "--json"]);
		const parsed = JSON.parse(output);
		for (const t of parsed) {
			expect(t.model).toBeDefined();
			expect(typeof t.model).toBe("string");
		}
		const t002 = parsed.find((t: { id: string }) => t.id === "T002");
		expect(t002.model).toBe("claude-opus-4-6");
		const t004 = parsed.find((t: { id: string }) => t.id === "T004");
		expect(t004.model).toBe("claude-sonnet-4-6");
	});

	test("--status filters by single status", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "pending", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(3);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T003", "T004"]);
	});

	test("--status filters by multiple comma-separated statuses", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "pending,failed", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(4);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T003", "T004", "T005"]);
	});

	test("--ready filters to only ready tasks", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(2);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T004"]);
	});

	test("--ready includes correct model assignment", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready", "--json",
		]);
		const parsed = JSON.parse(output);
		const t002 = parsed.find((t: { id: string }) => t.id === "T002");
		expect(t002.model).toBe("claude-opus-4-6");
		expect(t002.complexity).toBe("medium");
		const t004 = parsed.find((t: { id: string }) => t.id === "T004");
		expect(t004.model).toBe("claude-sonnet-4-6");
		expect(t004.complexity).toBe("low");
	});

	test("--after scopes to downstream tasks", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--after", "T001", "--json",
		]);
		const parsed = JSON.parse(output);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T003"]);
	});

	test("--after + --ready composes filters", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--after", "T001", "--ready", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].id).toBe("T002");
	});

	test("--include-content adds content field", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "complete", "--include-content", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].id).toBe("T001");
		expect(parsed[0].content).toContain("# T001: Init workspace");
	});

	test("content is absent without --include-content", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "complete", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed[0].content).toBeUndefined();
	});

	test("text output shows one-liner per task", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready",
		]);
		expect(output).toContain("2 task(s):");
		expect(output).toContain("T002: Build foundation [pending] (medium → claude-opus-4-6)");
		expect(output).toContain("T004: Independent task [pending] (low → claude-sonnet-4-6)");
		expect(output).not.toContain("T003");
	});

	test("text output with --include-content shows full content", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "complete", "--include-content",
		]);
		expect(output).toContain("--- T001: Init workspace [complete] ---");
		expect(output).toContain("Task description for T001.");
	});

	test("empty results shows message", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "skipped",
		]);
		expect(output).toContain("No tasks match the given filters.");
	});

	test("--after and --before are mutually exclusive", async () => {
		const origExit = process.exit;
		const origError = console.error;
		let exitCode: number | undefined;
		let errorMsg = "";
		process.exit = ((code: number) => { exitCode = code; }) as never;
		console.error = (...a: unknown[]) => { errorMsg = a.join(" "); };
		try {
			await runList([
				"--job", "test", "--project-root", tmpDir, "--after", "T001", "--before", "T002",
			]);
		} finally {
			process.exit = origExit;
			console.error = origError;
		}
		expect(exitCode).toBe(1);
		expect(errorMsg).toContain("mutually exclusive");
	});

	// Migrated from ready.test.ts
	test("no tasks ready shows message", async () => {
		const allBlockedFixture: TaskGraphData = {
			project: "blocked-project",
			tasks: {
				T001: {
					title: "Blocked task",
					status: "pending",
					dependencies: ["T999"],
					file: "jobs/test/tasks/T001.md",
					complexity: "low",
					attempts: 0,
				},
			},
		};
		const jobDir = join(tmpDir, "jobs", "test");
		await Bun.write(join(jobDir, "task-graph.json"), JSON.stringify(allBlockedFixture, null, 2));

		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready",
		]);
		expect(output).toContain("No tasks match the given filters.");
	});
});
```

**Step 2: Run tests**

Run: `cd dark-factory && bun test src/commands/list.test.ts`
Expected: All pass

**Step 3: Commit**

```
test: add comprehensive list command tests
```

---

### Task 6: Delete `ready` command and clean up

**Files:**
- Delete: `src/commands/ready.ts`
- Delete: `src/commands/ready.test.ts`
- Modify: `src/cli.ts` (remove ready import and registration)

**Step 1: Remove ready command from CLI**

In `src/cli.ts`:
- Remove line: `import { readyCommand } from "./commands/ready.js";`
- Remove line: `program.addCommand(readyCommand);`

**Step 2: Delete the files**

```bash
rm src/commands/ready.ts src/commands/ready.test.ts
```

**Step 3: Run all tests to verify nothing broke**

Run: `cd dark-factory && bun test`
Expected: All pass. No tests reference ready.ts.

**Step 4: Commit**

```
refactor: remove ready command (subsumed by list --ready)
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `cd dark-factory && bun test`
Expected: All pass

**Step 2: Manual smoke test**

If a real job exists, test a few combos:
```bash
bun run src/cli.ts list --job <name> --json
bun run src/cli.ts list --job <name> --ready --json
bun run src/cli.ts list --job <name> --status pending --json
bun run src/cli.ts list --job <name> --ready --include-content --json
```

**Step 3: Format and lint**

Run: `cd dark-factory && bun run format` (or whatever the project's format command is)

**Step 4: Final commit if needed**

```
chore: format
```
