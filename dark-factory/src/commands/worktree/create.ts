import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption, worktreeConfigFromJob } from "../../config/job.js";
import { createWorktree } from "../../core/worktree.js";
import { Logger } from "../../logging/logger.js";

export const worktreeCreateCommand = new Command("create")
	.description("Create a git worktree for a task")
	.argument("<task-id>", "Task ID (e.g. T001)")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.action(async (taskId, opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { job } = await requireJobOption(opts.job, projectRoot);
		const config = worktreeConfigFromJob(job, projectRoot);

		const logger = new Logger();
		const dir = await createWorktree(taskId, config, logger);
		console.log(dir);
	});
