import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption, worktreeConfigFromJob } from "../../config/job.js";
import { TaskGraph } from "../../core/task-graph.js";
import { mergeTask } from "../../core/worktree.js";
import { Logger } from "../../logging/logger.js";

export const worktreeMergeCommand = new Command("merge")
	.description("Squash-merge a task branch into the integration branch")
	.argument("<task-id>", "Task ID (e.g. T001)")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.action(async (taskId, opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { job, paths } = await requireJobOption(opts.job, projectRoot);
		const config = worktreeConfigFromJob(job, projectRoot);

		const tg = await TaskGraph.load(paths.taskGraph);
		const logger = new Logger();
		const ok = await mergeTask(taskId, config, tg, logger);
		if (!ok) {
			process.exit(1);
		}
	});
