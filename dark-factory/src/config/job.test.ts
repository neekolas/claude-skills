import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadJob,
	requireJobOption,
	resolveJobPaths,
	sanitizeJobName,
	worktreeConfigFromJob,
} from "./job.js";
import type { JobConfig } from "./types.js";

describe("sanitizeJobName", () => {
	test("lowercases input", () => {
		expect(sanitizeJobName("MyFeature")).toBe("myfeature");
	});

	test("replaces spaces with hyphens", () => {
		expect(sanitizeJobName("my cool feature")).toBe("my-cool-feature");
	});

	test("replaces underscores with hyphens", () => {
		expect(sanitizeJobName("my_cool_feature")).toBe("my-cool-feature");
	});

	test("strips special characters", () => {
		expect(sanitizeJobName("My Cool Feature!@#$%")).toBe("my-cool-feature");
	});

	test("collapses consecutive hyphens", () => {
		expect(sanitizeJobName("my--cool---feature")).toBe("my-cool-feature");
	});

	test("trims leading and trailing hyphens", () => {
		expect(sanitizeJobName("-my-feature-")).toBe("my-feature");
	});

	test("handles complex input", () => {
		expect(sanitizeJobName("  My Cool Feature!! v2.0  ")).toBe("my-cool-feature-v20");
	});

	test("throws on empty result", () => {
		expect(() => sanitizeJobName("!!!")).toThrow(
			"Job name must contain at least one alphanumeric character",
		);
	});
});

describe("resolveJobPaths", () => {
	test("returns correct paths for a job name", () => {
		const paths = resolveJobPaths("my-feature", "/repo");
		expect(paths.jobDir).toBe("/repo/jobs/my-feature");
		expect(paths.jobFile).toBe("/repo/jobs/my-feature/job.json");
		expect(paths.taskGraph).toBe("/repo/jobs/my-feature/task-graph.json");
		expect(paths.tasksDir).toBe("/repo/jobs/my-feature/tasks");
		expect(paths.outputDir).toBe("/repo/jobs/my-feature/tasks/output");
	});
});

describe("loadJob", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "df-job-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("loads a valid job.json", async () => {
		const jobDir = join(tmpDir, "jobs/my-feature");
		await mkdir(jobDir, { recursive: true });
		const config = {
			name: "my-feature",
			architecture_files: ["specs/ARCH.md"],
			task_graph: "jobs/my-feature/task-graph.json",
			tasks_dir: "jobs/my-feature/tasks",
			output_dir: "jobs/my-feature/tasks/output",
			integration_branch: "job/my-feature",
			worktree_base: "../.df-worktrees",
			branch_prefix: "df/my-feature/",
			model: "claude-opus-4-6",
			created_at: "2026-02-26T00:00:00Z",
		};
		await writeFile(join(jobDir, "job.json"), JSON.stringify(config));

		const loaded = await loadJob("my-feature", tmpDir);
		expect(loaded.name).toBe("my-feature");
		expect(loaded.integration_branch).toBe("job/my-feature");
		expect(loaded.branch_prefix).toBe("df/my-feature/");
	});

	test("throws if job does not exist", async () => {
		expect(loadJob("nonexistent", tmpDir)).rejects.toThrow();
	});
});

describe("worktreeConfigFromJob", () => {
	test("builds WorktreeConfig from JobConfig", () => {
		const job: JobConfig = {
			name: "my-feature",
			architecture_files: [],
			task_graph: "jobs/my-feature/task-graph.json",
			tasks_dir: "jobs/my-feature/tasks",
			output_dir: "jobs/my-feature/tasks/output",
			integration_branch: "job/my-feature",
			worktree_base: "../.df-worktrees",
			branch_prefix: "df/my-feature/",
			model: "claude-opus-4-6",
			created_at: "2026-02-26T00:00:00Z",
		};
		const config = worktreeConfigFromJob(job, "/repo");
		expect(config.projectRoot).toBe("/repo");
		expect(config.integrationBranch).toBe("job/my-feature");
		expect(config.branchPrefix).toBe("df/my-feature/");
		expect(config.worktreeBase).toBe("/.df-worktrees");
	});
});

describe("requireJobOption", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "df-job-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("returns job config and paths when job exists", async () => {
		const jobDir = join(tmpDir, "jobs/my-feature");
		await mkdir(jobDir, { recursive: true });
		const config = {
			name: "my-feature",
			architecture_files: [],
			task_graph: "jobs/my-feature/task-graph.json",
			tasks_dir: "jobs/my-feature/tasks",
			output_dir: "jobs/my-feature/tasks/output",
			integration_branch: "job/my-feature",
			worktree_base: "../.df-worktrees",
			branch_prefix: "df/my-feature/",
			model: "claude-opus-4-6",
			created_at: "2026-02-26T00:00:00Z",
		};
		await writeFile(join(jobDir, "job.json"), JSON.stringify(config));

		const result = await requireJobOption("my-feature", tmpDir);
		expect(result.job.name).toBe("my-feature");
		expect(result.paths.jobDir).toBe(jobDir);
	});

	test("throws with helpful message when job name is undefined", async () => {
		expect(requireJobOption(undefined, tmpDir)).rejects.toThrow("--job <name> is required");
	});
});
