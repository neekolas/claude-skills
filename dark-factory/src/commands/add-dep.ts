import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import { autoCommit } from "../core/auto-commit.js";
import { TaskGraph } from "../core/task-graph.js";

export const addDepCommand = new Command("add-dep")
	.description("Add a dependency to a task")
	.argument("<task-id>", "Task to add dependency to")
	.argument("<dep-id>", "Task ID to depend on")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.action(async (taskId, depId, opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { paths } = await requireJobOption(opts.job, projectRoot);
		const tg = await TaskGraph.load(paths.taskGraph);
		await tg.addDep(taskId, depId);
		console.log(`${taskId} now depends on ${depId}`);
		await autoCommit(
			[paths.taskGraph],
			`dark-factory: add dependency ${taskId} → ${depId}`,
			projectRoot,
		);
	});
