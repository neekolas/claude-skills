import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import type { TaskStatus } from "../config/types.js";
import { autoCommit } from "../core/auto-commit.js";
import { TaskGraph } from "../core/task-graph.js";

const VALID_STATUSES: TaskStatus[] = ["pending", "in-progress", "complete", "failed", "skipped"];

export const setStatusCommand = new Command("set-status")
	.description("Update a task's status")
	.argument("<task-id>", "Task ID (e.g. T001)")
	.argument("<status>", `Status: ${VALID_STATUSES.join(", ")}`)
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.action(async (taskId, status, opts) => {
		if (!VALID_STATUSES.includes(status)) {
			console.error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`);
			process.exit(1);
		}
		const projectRoot = resolve(opts.projectRoot);
		const { paths } = await requireJobOption(opts.job, projectRoot);
		const tg = await TaskGraph.load(paths.taskGraph);
		await tg.setStatus(taskId, status);
		console.log(`${taskId} → ${status}`);
		await autoCommit(
			[paths.taskGraph],
			`dark-factory: set ${taskId} status to ${status}`,
			projectRoot,
		);
	});
