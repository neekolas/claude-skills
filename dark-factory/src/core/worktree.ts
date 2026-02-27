import type { WorktreeConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import { exec } from "./exec.js";
import type { TaskGraph } from "./task-graph.js";

export async function createWorktree(
	taskId: string,
	config: WorktreeConfig,
	logger: Logger,
): Promise<string> {
	const branch = `${config.branchPrefix}${taskId}`;
	const dir = `${config.worktreeBase}/${taskId}`;

	// Remove existing worktree if present
	await exec(["git", "-C", config.projectRoot, "worktree", "remove", dir, "--force"]);

	// Try to create worktree
	let result = await exec([
		"git",
		"-C",
		config.projectRoot,
		"worktree",
		"add",
		dir,
		"-b",
		branch,
		config.integrationBranch,
	]);

	if (!result.ok) {
		// Branch may already exist — delete and retry
		await exec(["git", "-C", config.projectRoot, "branch", "-D", branch]);
		result = await exec([
			"git",
			"-C",
			config.projectRoot,
			"worktree",
			"add",
			dir,
			"-b",
			branch,
			config.integrationBranch,
		]);
		if (!result.ok) {
			throw new Error(`Failed to create worktree for ${taskId}: ${result.output}`);
		}
	}

	logger.log(`Created worktree for ${taskId} at ${dir}`);
	return dir;
}

export async function removeWorktree(taskId: string, config: WorktreeConfig): Promise<void> {
	const dir = `${config.worktreeBase}/${taskId}`;
	const branch = `${config.branchPrefix}${taskId}`;
	await exec(["git", "-C", config.projectRoot, "worktree", "remove", dir, "--force"]);
	await exec(["git", "-C", config.projectRoot, "branch", "-D", branch]);
}

export async function mergeTask(
	taskId: string,
	config: WorktreeConfig,
	taskGraph: TaskGraph,
	logger: Logger,
): Promise<boolean> {
	const branch = `${config.branchPrefix}${taskId}`;
	const title = taskGraph.getTask(taskId)?.title ?? taskId;

	// Ensure we're on integration branch
	const currentBranch = await exec(["git", "-C", config.projectRoot, "branch", "--show-current"]);
	if (currentBranch.output.trim() !== config.integrationBranch) {
		await exec(["git", "-C", config.projectRoot, "checkout", config.integrationBranch]);
	}

	// Squash merge
	const mergeResult = await exec(["git", "-C", config.projectRoot, "merge", "--squash", branch]);

	if (!mergeResult.ok) {
		logger.err(`Merge conflict on ${taskId}`);
		await exec(["git", "-C", config.projectRoot, "merge", "--abort"]);
		return false;
	}

	// Commit
	const commitResult = await exec([
		"git",
		"-C",
		config.projectRoot,
		"commit",
		"-m",
		`feat(${taskId}): ${title}`,
		"--no-edit",
	]);

	if (!commitResult.ok) {
		logger.warn(`${taskId}: no changes to merge`);
		return false;
	}

	// Push (non-blocking — warn on failure)
	const pushResult = await exec([
		"git",
		"-C",
		config.projectRoot,
		"push",
		"origin",
		config.integrationBranch,
	]);
	if (!pushResult.ok) {
		logger.warn(`${taskId}: push failed (will retry on next merge)`);
	}

	logger.ok(`Merged ${taskId} into ${config.integrationBranch}`);
	return true;
}
