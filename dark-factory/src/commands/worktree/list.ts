import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption, worktreeConfigFromJob } from "../../config/job.js";

/** Task ID pattern: T followed by digits (e.g. T001, T042) */
const TASK_ID_RE = /^T\d+$/;

export async function listWorktrees(worktreeBase: string): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(worktreeBase);
	} catch {
		return []; // Directory doesn't exist — no worktrees
	}

	const taskIds: string[] = [];
	for (const entry of entries) {
		if (!TASK_ID_RE.test(entry)) continue;
		const entryPath = join(worktreeBase, entry);
		const info = await stat(entryPath);
		if (info.isDirectory()) {
			taskIds.push(entry);
		}
	}

	return taskIds.sort();
}

export const worktreeListCommand = new Command("list")
	.description("List active task worktrees")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.option("--json", "Output as JSON")
	.action(async (opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { job } = await requireJobOption(opts.job, projectRoot);
		const config = worktreeConfigFromJob(job, projectRoot);
		const worktreeBase = config.worktreeBase;

		const taskIds = await listWorktrees(worktreeBase);

		if (opts.json) {
			console.log(JSON.stringify({ worktreeBase, tasks: taskIds }));
			return;
		}

		if (taskIds.length === 0) {
			console.log("No active worktrees");
			return;
		}

		console.log(`Worktrees in ${worktreeBase}:`);
		for (const id of taskIds) {
			console.log(`  ${id}`);
		}
	});
