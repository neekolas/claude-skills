import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import type { Complexity } from "../config/types.js";
import { autoCommit } from "../core/auto-commit.js";
import { TaskGraph } from "../core/task-graph.js";

export const addTaskCommand = new Command("add-task")
	.description("Create a new task file and add it to the graph")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.option("--id <id>", "Task ID (auto-generated if omitted)")
	.requiredOption("--title <title>", "Task title")
	.option("--deps <ids>", "Comma-separated dependency task IDs", "")
	.option("--complexity <level>", "low, medium, or high", "medium")
	.action(async (opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { job, paths } = await requireJobOption(opts.job, projectRoot);
		const tg = await TaskGraph.load(paths.taskGraph);
		const taskId = opts.id || tg.nextTaskId();
		const deps = opts.deps
			? opts.deps
					.split(",")
					.map((s: string) => s.trim())
					.filter(Boolean)
			: [];
		const complexity = opts.complexity as Complexity;
		const relPath = `${job.tasks_dir}/${taskId}.md`;
		const absPath = join(projectRoot, relPath);

		await mkdir(dirname(absPath), { recursive: true });
		const content = `# ${taskId}: ${opts.title}

**Dependencies**: ${deps.length > 0 ? deps.join(", ") : "None"}
**Estimated Complexity**: ${complexity.charAt(0).toUpperCase() + complexity.slice(1)}

## Description
[TODO: Add description]

## Files Created/Modified
[TODO: List files]

## Implementation Details
[TODO: Add implementation details]

## Acceptance Criteria
[TODO: Define acceptance criteria]

## Verification Steps
[TODO: Define verification steps]

## Context Files
[TODO: List context files]
`;
		await writeFile(absPath, content);

		await tg.addTask(taskId, {
			title: opts.title,
			status: "pending",
			dependencies: deps,
			file: relPath,
			complexity,
			attempts: 0,
		});

		console.log(`Created ${taskId}: ${opts.title}`);
		console.log(`  File: ${relPath}`);
		await autoCommit([paths.taskGraph, absPath], `dark-factory: add task ${taskId}`, projectRoot);
	});
