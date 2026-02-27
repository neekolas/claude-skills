import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobConfig, TaskGraphData } from "../config/types.js";

const FIXTURE: TaskGraphData = {
	project: "test-get-set-project",
	tasks: {
		T001: {
			title: "Init workspace",
			status: "pending",
			dependencies: [],
			file: "jobs/test/tasks/T001.md",
			complexity: "low",
			attempts: 0,
		},
		T002: {
			title: "Build foundation",
			status: "pending",
			dependencies: ["T001"],
			file: "jobs/test/tasks/T002.md",
			complexity: "medium",
			attempts: 0,
		},
	},
};

const JOB_CONFIG: JobConfig = {
	name: "test",
	architecture_files: [],
	task_graph: "jobs/test/task-graph.json",
	tasks_dir: "jobs/test/tasks",
	output_dir: "jobs/test/tasks/output",
	integration_branch: "develop",
	worktree_base: "../.df-worktrees",
	branch_prefix: "df/test/",
	model: "claude-opus-4-6",
	created_at: "2026-01-01T00:00:00Z",
};

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-get-set-test-"));
	const jobDir = join(tmpDir, "jobs", "test");
	const tasksDir = join(jobDir, "tasks");
	await mkdir(tasksDir, { recursive: true });
	await Bun.write(join(jobDir, "job.json"), JSON.stringify(JOB_CONFIG, null, 2));
	await Bun.write(join(jobDir, "task-graph.json"), JSON.stringify(FIXTURE, null, 2));

	// Create task markdown files
	await Bun.write(join(tasksDir, "T001.md"), "# T001: Init workspace\n\nSet up the project.\n");
	await Bun.write(join(tasksDir, "T002.md"), "# T002: Build foundation\n\nBuild core modules.\n");
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function runGet(
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	const { getCommand } = await import("./get.js");
	const lines: string[] = [];
	const errLines: string[] = [];
	const origLog = console.log;
	const origErr = console.error;
	let exitCode: number | null = null;
	const origExit = process.exit;

	console.log = (...a: unknown[]) => lines.push(a.join(" "));
	console.error = (...a: unknown[]) => errLines.push(a.join(" "));
	process.exit = ((code?: number) => {
		exitCode = code ?? 0;
		throw new Error(`process.exit(${code})`);
	}) as never;

	try {
		await getCommand.parseAsync(["node", "get", ...args]);
	} catch (e: unknown) {
		if (!(e instanceof Error && e.message.startsWith("process.exit("))) {
			throw e;
		}
	} finally {
		console.log = origLog;
		console.error = origErr;
		process.exit = origExit;
	}
	return { stdout: lines.join("\n"), stderr: errLines.join("\n"), exitCode };
}

async function runSetStatus(
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	const { setStatusCommand } = await import("./set-status.js");
	const lines: string[] = [];
	const errLines: string[] = [];
	const origLog = console.log;
	const origErr = console.error;
	let exitCode: number | null = null;
	const origExit = process.exit;

	console.log = (...a: unknown[]) => lines.push(a.join(" "));
	console.error = (...a: unknown[]) => errLines.push(a.join(" "));
	process.exit = ((code?: number) => {
		exitCode = code ?? 0;
		throw new Error(`process.exit(${code})`);
	}) as never;

	try {
		await setStatusCommand.parseAsync(["node", "set-status", ...args]);
	} catch (e: unknown) {
		if (!(e instanceof Error && e.message.startsWith("process.exit("))) {
			throw e;
		}
	} finally {
		console.log = origLog;
		console.error = origErr;
		process.exit = origExit;
	}
	return { stdout: lines.join("\n"), stderr: errLines.join("\n"), exitCode };
}

describe("get command", () => {
	test("prints task file contents when given valid task ID", async () => {
		const result = await runGet(["T001", "--job", "test", "--project-root", tmpDir]);

		expect(result.exitCode).toBeNull(); // no process.exit called
		expect(result.stdout).toContain("# T001: Init workspace");
		expect(result.stdout).toContain("Set up the project.");
	});

	test("exits with error for unknown task", async () => {
		const result = await runGet(["T999", "--job", "test", "--project-root", tmpDir]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Task T999 not found");
	});
});

describe("set-status command", () => {
	test("updates task status and persists to disk", async () => {
		const graphPath = join(tmpDir, "jobs", "test", "task-graph.json");
		const result = await runSetStatus([
			"T001",
			"in-progress",
			"--job",
			"test",
			"--project-root",
			tmpDir,
		]);

		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("T001");
		expect(result.stdout).toContain("in-progress");

		// Verify persistence: re-read the file and check
		const raw = await Bun.file(graphPath).text();
		const data = JSON.parse(raw) as TaskGraphData;
		expect(data.tasks.T001.status).toBe("in-progress");
	});

	test("rejects invalid status values", async () => {
		const result = await runSetStatus(["T001", "bogus", "--job", "test", "--project-root", tmpDir]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('Invalid status "bogus"');
		expect(result.stderr).toContain("pending");
		expect(result.stderr).toContain("in-progress");
		expect(result.stderr).toContain("complete");
	});
});
