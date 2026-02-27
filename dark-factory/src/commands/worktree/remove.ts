import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption, worktreeConfigFromJob } from "../../config/job.js";
import { removeWorktree } from "../../core/worktree.js";

export const worktreeRemoveCommand = new Command("remove")
	.description("Remove a git worktree for a task")
	.argument("<task-id>", "Task ID (e.g. T001)")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.action(async (taskId, opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { job } = await requireJobOption(opts.job, projectRoot);
		const config = worktreeConfigFromJob(job, projectRoot);

		await removeWorktree(taskId, config);
		console.log(`Removed worktree for ${taskId}`);
	});
