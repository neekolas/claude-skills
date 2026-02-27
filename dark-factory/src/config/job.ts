import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { JobConfig, WorktreeConfig } from "./types.js";

export interface JobPaths {
	jobDir: string;
	jobFile: string;
	taskGraph: string;
	tasksDir: string;
	outputDir: string;
}

export function resolveJobPaths(jobName: string, projectRoot: string): JobPaths {
	const jobDir = join(projectRoot, "jobs", jobName);
	return {
		jobDir,
		jobFile: join(jobDir, "job.json"),
		taskGraph: join(jobDir, "task-graph.json"),
		tasksDir: join(jobDir, "tasks"),
		outputDir: join(jobDir, "tasks", "output"),
	};
}

export async function loadJob(jobName: string, projectRoot: string): Promise<JobConfig> {
	const { jobFile } = resolveJobPaths(jobName, projectRoot);
	const raw = await readFile(jobFile, "utf-8");
	return JSON.parse(raw) as JobConfig;
}

export function worktreeConfigFromJob(job: JobConfig, projectRoot: string): WorktreeConfig {
	return {
		projectRoot,
		worktreeBase: resolve(projectRoot, job.worktree_base),
		branchPrefix: job.branch_prefix,
		integrationBranch: job.integration_branch,
	};
}

export async function requireJobOption(
	jobName: string | undefined,
	projectRoot: string,
): Promise<{ job: JobConfig; paths: JobPaths }> {
	if (!jobName) {
		throw new Error(
			"--job <name> is required.\n\nTo find the current job from your git branch, run:\n  dark-factory current-job",
		);
	}
	const paths = resolveJobPaths(jobName, projectRoot);
	const job = await loadJob(jobName, projectRoot);
	return { job, paths };
}

export function sanitizeJobName(input: string): string {
	const name = input
		.toLowerCase()
		.trim()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");

	if (name.length === 0) {
		throw new Error("Job name must contain at least one alphanumeric character");
	}
	return name;
}
