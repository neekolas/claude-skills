import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { sanitizeJobName } from "../config/job.js";
import type { JobConfig, TaskGraphData } from "../config/types.js";
import { autoCommit } from "../core/auto-commit.js";
import { exec } from "../core/exec.js";

// ── Job scaffolding ──────────────────────────────────────────────────────

/**
 * Scaffold a new job: create directory structure, job.json, and empty task graph.
 * Pure filesystem operations — no git — so this is easily testable.
 */
export async function initJob(
	name: string,
	architectureFiles: string[],
	projectRoot: string,
): Promise<{ name: string; jobDir: string }> {
	const sanitizedName = sanitizeJobName(name);
	const jobDir = join(projectRoot, "jobs", sanitizedName);

	// Check if job already exists
	try {
		const s = await stat(jobDir);
		if (s.isDirectory()) {
			throw new Error(`Job '${sanitizedName}' already exists`);
		}
	} catch (err: unknown) {
		// ENOENT means directory doesn't exist — that's what we want
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			// Good — directory doesn't exist yet
		} else {
			throw err;
		}
	}

	// Create directory structure
	const outputDir = join(jobDir, "tasks", "output");
	await mkdir(outputDir, { recursive: true });

	// Write job.json
	const jobConfig: JobConfig = {
		name: sanitizedName,
		architecture_files: architectureFiles,
		task_graph: `jobs/${sanitizedName}/task-graph.json`,
		tasks_dir: `jobs/${sanitizedName}/tasks`,
		output_dir: `jobs/${sanitizedName}/tasks/output`,
		integration_branch: `job/${sanitizedName}`,
		worktree_base: "../.df-worktrees",
		branch_prefix: `df/${sanitizedName}/`,
		model: "claude-opus-4-6",
		created_at: new Date().toISOString(),
	};
	await writeFile(join(jobDir, "job.json"), `${JSON.stringify(jobConfig, null, 2)}\n`);

	// Write empty task graph
	const taskGraph: TaskGraphData = {
		project: sanitizedName,
		tasks: {},
	};
	await writeFile(join(jobDir, "task-graph.json"), `${JSON.stringify(taskGraph, null, 2)}\n`);

	return { name: sanitizedName, jobDir: resolve(jobDir) };
}

// ── Command ──────────────────────────────────────────────────────────────

export const initCommand = new Command("init")
	.description("Initialize a new job (creates folder structure, job.json, empty task graph)")
	.requiredOption("--name <name>", "Job name (will be sanitized)")
	.requiredOption("--architecture <paths...>", "Path(s) to architecture/spec document(s)")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.action(async (opts) => {
		const projectRoot: string = opts.projectRoot;
		const { name, jobDir } = await initJob(opts.name, opts.architecture, projectRoot);

		// Create git branch for the job
		const branchName = `job/${name}`;
		const branchResult = await exec(["git", "checkout", "-b", branchName], projectRoot);
		if (!branchResult.ok) {
			console.error(`Failed to create branch ${branchName}: ${branchResult.stderr}`);
			process.exit(1);
		}

		// Auto-commit the job scaffold files
		await autoCommit(
			[join(jobDir, "job.json"), join(jobDir, "task-graph.json")],
			`feat: initialize job "${name}"`,
			projectRoot,
		);

		console.log(`Job "${name}" initialized on branch ${branchName}`);
		console.log(`Next: dark-factory extract-tasks --job ${name}`);
	});
