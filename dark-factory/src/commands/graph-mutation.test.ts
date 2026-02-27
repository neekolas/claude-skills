import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobConfig, TaskGraphData } from "../config/types.js";

const FIXTURE: TaskGraphData = {
	project: "test-graph-mutation",
	tasks: {
		T001: {
			title: "Init workspace",
			status: "complete",
			dependencies: [],
			file: "jobs/test/tasks/T001.md",
			complexity: "low",
			attempts: 1,
		},
		T002: {
			title: "Build foundation",
			status: "pending",
			dependencies: ["T001"],
			file: "jobs/test/tasks/T002.md",
			complexity: "medium",
			attempts: 0,
		},
		T003: {
			title: "Implement feature",
			status: "pending",
			dependencies: ["T002"],
			file: "jobs/test/tasks/T003.md",
			complexity: "high",
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
let graphPath: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-graph-mutation-test-"));
	const jobDir = join(tmpDir, "jobs", "test");
	const tasksDir = join(jobDir, "tasks");
	await mkdir(tasksDir, { recursive: true });
	await Bun.write(join(jobDir, "job.json"), JSON.stringify(JOB_CONFIG, null, 2));
	graphPath = join(jobDir, "task-graph.json");
	await Bun.write(graphPath, JSON.stringify(FIXTURE, null, 2));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Helper: run a command and capture stdout/stderr.
 */
async function runCommand(
	importFn: () => Promise<{ parseAsync: (argv: string[]) => Promise<unknown> }>,
	cmdName: string,
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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
		const cmd = await importFn();
		await cmd.parseAsync(["node", cmdName, ...args]);
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

async function runAddTask(args: string[]) {
	return runCommand(
		async () => {
			const { addTaskCommand } = await import("./add-task.js");
			return addTaskCommand;
		},
		"add-task",
		args,
	);
}

async function runAddDep(args: string[]) {
	return runCommand(
		async () => {
			const { addDepCommand } = await import("./add-dep.js");
			return addDepCommand;
		},
		"add-dep",
		args,
	);
}

async function runDependents(args: string[]) {
	return runCommand(
		async () => {
			const { dependentsCommand } = await import("./dependents.js");
			return dependentsCommand;
		},
		"dependents",
		args,
	);
}

async function runMoveDeps(args: string[]) {
	return runCommand(
		async () => {
			const { moveDepsCommand } = await import("./move-deps.js");
			return moveDepsCommand;
		},
		"move-deps",
		args,
	);
}

function readGraph(path: string): Promise<TaskGraphData> {
	return Bun.file(path)
		.text()
		.then((raw) => JSON.parse(raw) as TaskGraphData);
}

describe("add-task command", () => {
	test("creates a markdown file and adds entry to graph", async () => {
		const result = await runAddTask([
			"--job",
			"test",
			"--project-root",
			tmpDir,
			"--id",
			"T010",
			"--title",
			"New task",
			"--deps",
			"T001,T002",
			"--complexity",
			"high",
		]);

		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("Created T010: New task");
		expect(result.stdout).toContain("jobs/test/tasks/T010.md");

		// Verify markdown file was created
		const mdPath = join(tmpDir, "jobs", "test", "tasks", "T010.md");
		const mdContent = await readFile(mdPath, "utf-8");
		expect(mdContent).toContain("# T010: New task");
		expect(mdContent).toContain("T001, T002");
		expect(mdContent).toContain("High");

		// Verify graph was updated
		const data = await readGraph(graphPath);
		expect(data.tasks.T010).toBeDefined();
		expect(data.tasks.T010.title).toBe("New task");
		expect(data.tasks.T010.dependencies).toEqual(["T001", "T002"]);
		expect(data.tasks.T010.complexity).toBe("high");
		expect(data.tasks.T010.status).toBe("pending");
	});

	test("auto-generates task ID when --id not provided", async () => {
		const result = await runAddTask([
			"--job",
			"test",
			"--project-root",
			tmpDir,
			"--title",
			"Auto ID task",
		]);

		expect(result.exitCode).toBeNull();
		// Next ID after T003 should be T004
		expect(result.stdout).toContain("Created T004: Auto ID task");

		const data = await readGraph(graphPath);
		expect(data.tasks.T004).toBeDefined();
		expect(data.tasks.T004.title).toBe("Auto ID task");
		expect(data.tasks.T004.dependencies).toEqual([]);
		expect(data.tasks.T004.complexity).toBe("medium"); // default
	});
});

describe("add-dep command", () => {
	test("adds a dependency and persists", async () => {
		const result = await runAddDep(["T003", "T001", "--job", "test", "--project-root", tmpDir]);

		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("T003 now depends on T001");

		// Verify persistence
		const data = await readGraph(graphPath);
		expect(data.tasks.T003.dependencies).toContain("T001");
		expect(data.tasks.T003.dependencies).toContain("T002");
	});
});

describe("dependents command", () => {
	test("--json returns dependent task IDs", async () => {
		const result = await runDependents([
			"T001",
			"--job",
			"test",
			"--project-root",
			tmpDir,
			"--json",
		]);

		expect(result.exitCode).toBeNull();
		const parsed = JSON.parse(result.stdout);
		expect(parsed).toEqual(["T002"]);
	});

	test("formatted output lists dependents", async () => {
		const result = await runDependents(["T002", "--job", "test", "--project-root", tmpDir]);

		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("Tasks depending on T002:");
		expect(result.stdout).toContain("T003: Implement feature");
	});

	test("shows message when no dependents exist", async () => {
		const result = await runDependents(["T003", "--job", "test", "--project-root", tmpDir]);

		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("No tasks depend on T003");
	});
});

describe("move-deps command", () => {
	test("rewires dependencies correctly", async () => {
		// T003 depends on T002. Rewire T002 -> T010, T011
		// First add T010 and T011 so the graph has them
		const data = await readGraph(graphPath);
		data.tasks.T010 = {
			title: "Replacement A",
			status: "pending",
			dependencies: ["T001"],
			file: "jobs/test/tasks/T010.md",
			complexity: "low",
			attempts: 0,
		};
		data.tasks.T011 = {
			title: "Replacement B",
			status: "pending",
			dependencies: ["T001"],
			file: "jobs/test/tasks/T011.md",
			complexity: "low",
			attempts: 0,
		};
		await Bun.write(graphPath, JSON.stringify(data, null, 2));

		const result = await runMoveDeps([
			"--from",
			"T002",
			"--to",
			"T010,T011",
			"--job",
			"test",
			"--project-root",
			tmpDir,
		]);

		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("Rewired 1 task(s)");
		expect(result.stdout).toContain("Updated: T003");

		// Verify T003 now depends on T010, T011 instead of T002
		const updated = await readGraph(graphPath);
		expect(updated.tasks.T003.dependencies).toContain("T010");
		expect(updated.tasks.T003.dependencies).toContain("T011");
		expect(updated.tasks.T003.dependencies).not.toContain("T002");
	});
});
