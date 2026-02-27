import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { SCAFFOLD_MARKER } from "../config/defaults.js";
import { requireJobOption, worktreeConfigFromJob } from "../config/job.js";
import type { TaskState } from "../config/types.js";
import { TaskGraph } from "../core/task-graph.js";

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function deriveTaskState(
	taskId: string,
	tg: TaskGraph,
	projectRoot: string,
	worktreeBase: string,
	outputDir: string,
): Promise<TaskState> {
	const task = tg.getTask(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);

	// Terminal states from graph
	if (task.status === "complete") return "complete";
	if (task.status === "failed") return "failed";
	if (task.status === "skipped") return "complete";

	// Check durable artifacts
	const worktreeDir = join(worktreeBase, taskId);
	const hasWorktree = await fileExists(worktreeDir);
	const hasScaffold = hasWorktree && (await fileExists(join(worktreeDir, SCAFFOLD_MARKER)));
	const resultFile = join(outputDir, `${taskId}.md`);
	const hasResult = await fileExists(resultFile);

	if (hasResult) return "evaluating";
	if (hasScaffold) return "scaffolded";
	if (hasWorktree && task.status === "in-progress") return "worktree-created";
	return "pending";
}

export const taskStateCommand = new Command("task-state")
	.description("Show a task's recovery state based on durable artifacts")
	.argument("<task-id>", "Task ID")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root", process.cwd())
	.option("--json", "Output as JSON")
	.action(async (taskId, opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { job, paths } = await requireJobOption(opts.job, projectRoot);
		const wtConfig = worktreeConfigFromJob(job, projectRoot);
		const tg = await TaskGraph.load(paths.taskGraph);
		const state = await deriveTaskState(
			taskId,
			tg,
			projectRoot,
			wtConfig.worktreeBase,
			paths.outputDir,
		);

		if (opts.json) {
			console.log(JSON.stringify({ taskId, state }));
		} else {
			console.log(`${taskId}: ${state}`);
		}
	});
