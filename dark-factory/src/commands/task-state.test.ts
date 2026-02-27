import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCAFFOLD_MARKER } from "../config/defaults.js";
import type { JobConfig, TaskGraphData } from "../config/types.js";

function makeFixture(
	overrides?: Partial<Record<string, Partial<TaskGraphData["tasks"][string]>>>,
): TaskGraphData {
	const base: TaskGraphData = {
		project: "test-task-state",
		tasks: {
			T001: {
				title: "Pending task",
				status: "pending",
				dependencies: [],
				file: "specs/tasks/T001.md",
				complexity: "low",
				attempts: 0,
			},
			T002: {
				title: "In-progress task",
				status: "in-progress",
				dependencies: [],
				file: "specs/tasks/T002.md",
				complexity: "medium",
				attempts: 0,
			},
			T003: {
				title: "Complete task",
				status: "complete",
				dependencies: [],
				file: "specs/tasks/T003.md",
				complexity: "low",
				attempts: 1,
			},
			T004: {
				title: "Failed task",
				status: "failed",
				dependencies: [],
				file: "specs/tasks/T004.md",
				complexity: "high",
				attempts: 3,
			},
			T005: {
				title: "Skipped task",
				status: "skipped",
				dependencies: [],
				file: "specs/tasks/T005.md",
				complexity: "low",
				attempts: 0,
			},
		},
	};
	if (overrides) {
		for (const [id, patch] of Object.entries(overrides)) {
			if (base.tasks[id]) {
				Object.assign(base.tasks[id], patch);
			}
		}
	}
	return base;
}

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
let worktreeBase: string;
let projectRoot: string;
let outputDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-task-state-test-"));
	projectRoot = join(tmpDir, "project");
	worktreeBase = join(tmpDir, "worktrees");
	const jobDir = join(projectRoot, "jobs", "test");
	outputDir = join(jobDir, "tasks", "output");
	await mkdir(projectRoot, { recursive: true });
	await mkdir(worktreeBase, { recursive: true });
	await mkdir(outputDir, { recursive: true });
	graphPath = join(jobDir, "task-graph.json");
	await Bun.write(join(jobDir, "job.json"), JSON.stringify(JOB_CONFIG, null, 2));
	await Bun.write(graphPath, JSON.stringify(makeFixture(), null, 2));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("deriveTaskState", () => {
	test("returns 'pending' when task is pending and no worktree exists", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		const state = await deriveTaskState("T001", tg, projectRoot, worktreeBase, outputDir);
		expect(state).toBe("pending");
	});

	test("returns 'worktree-created' when worktree exists but no scaffold marker", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		// Create worktree directory for T002 (in-progress)
		await mkdir(join(worktreeBase, "T002"), { recursive: true });

		const state = await deriveTaskState("T002", tg, projectRoot, worktreeBase, outputDir);
		expect(state).toBe("worktree-created");
	});

	test("returns 'scaffolded' when worktree exists AND scaffold marker exists", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		// Create worktree + scaffold marker for T002 (in-progress)
		const wtDir = join(worktreeBase, "T002");
		await mkdir(wtDir, { recursive: true });
		await Bun.write(join(wtDir, SCAFFOLD_MARKER), "");

		const state = await deriveTaskState("T002", tg, projectRoot, worktreeBase, outputDir);
		expect(state).toBe("scaffolded");
	});

	test("returns 'evaluating' when result file exists", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		// Create worktree + scaffold + result file for T002
		const wtDir = join(worktreeBase, "T002");
		await mkdir(wtDir, { recursive: true });
		await Bun.write(join(wtDir, SCAFFOLD_MARKER), "");

		await Bun.write(join(outputDir, "T002.md"), "# Result\nPass");

		const state = await deriveTaskState("T002", tg, projectRoot, worktreeBase, outputDir);
		expect(state).toBe("evaluating");
	});

	test("returns 'complete' when task status is 'complete'", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		const state = await deriveTaskState("T003", tg, projectRoot, worktreeBase, outputDir);
		expect(state).toBe("complete");
	});

	test("returns 'complete' when task status is 'skipped'", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		const state = await deriveTaskState("T005", tg, projectRoot, worktreeBase, outputDir);
		expect(state).toBe("complete");
	});

	test("returns 'failed' when task status is 'failed'", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		const state = await deriveTaskState("T004", tg, projectRoot, worktreeBase, outputDir);
		expect(state).toBe("failed");
	});

	test("throws for unknown task ID", async () => {
		const { deriveTaskState } = await import("./task-state.js");
		const { TaskGraph } = await import("../core/task-graph.js");
		const tg = await TaskGraph.load(graphPath);

		expect(deriveTaskState("T999", tg, projectRoot, worktreeBase, outputDir)).rejects.toThrow(
			"Task T999 not found",
		);
	});
});

describe("task-state CLI", () => {
	async function runTaskState(
		args: string[],
	): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
		const { taskStateCommand } = await import("./task-state.js");
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
			await taskStateCommand.parseAsync(["node", "task-state", ...args]);
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

	test("--json outputs valid JSON with taskId and state", async () => {
		const result = await runTaskState([
			"T001",
			"--job",
			"test",
			"--project-root",
			projectRoot,
			"--json",
		]);

		expect(result.exitCode).toBeNull();
		const parsed = JSON.parse(result.stdout);
		expect(parsed.taskId).toBe("T001");
		expect(parsed.state).toBe("pending");
	});

	test("plain output shows taskId and state", async () => {
		const result = await runTaskState(["T003", "--job", "test", "--project-root", projectRoot]);

		expect(result.exitCode).toBeNull();
		expect(result.stdout).toBe("T003: complete");
	});
});
