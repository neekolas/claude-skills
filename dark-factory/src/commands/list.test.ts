import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobConfig, TaskGraphData } from "../config/types.js";

// T001: complete, no deps
// T002: pending, deps [T001] → ready, medium
// T003: pending, deps [T002] → blocked, high
// T004: pending, no deps → ready, low
// T005: failed, no deps
const FIXTURE: TaskGraphData = {
	project: "test-list-project",
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
		T004: {
			title: "Independent task",
			status: "pending",
			dependencies: [],
			file: "jobs/test/tasks/T004.md",
			complexity: "low",
			attempts: 0,
		},
		T005: {
			title: "Broken task",
			status: "failed",
			dependencies: [],
			file: "jobs/test/tasks/T005.md",
			complexity: "low",
			attempts: 2,
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
	tmpDir = await mkdtemp(join(tmpdir(), "df-list-test-"));
	const jobDir = join(tmpDir, "jobs", "test");
	const tasksDir = join(tmpDir, "jobs", "test", "tasks");
	await mkdir(tasksDir, { recursive: true });
	await Bun.write(join(jobDir, "job.json"), JSON.stringify(JOB_CONFIG, null, 2));
	await Bun.write(join(jobDir, "task-graph.json"), JSON.stringify(FIXTURE, null, 2));

	// Write markdown content for tasks
	for (const [id, task] of Object.entries(FIXTURE.tasks)) {
		await writeFile(
			join(tmpDir, task.file),
			`# ${id}: ${task.title}\n\nTask description for ${id}.\n`,
		);
	}
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function runList(args: string[]): Promise<string> {
	const { listCommand } = await import("./list.js");
	const lines: string[] = [];
	const origLog = console.log;
	console.log = (...a: unknown[]) => lines.push(a.join(" "));
	try {
		await listCommand.parseAsync(["node", "list", ...args]);
	} finally {
		console.log = origLog;
	}
	return lines.join("\n");
}

describe("list command", () => {
	test("no filters lists all tasks", async () => {
		const output = await runList(["--job", "test", "--project-root", tmpDir, "--json"]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(5);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T001", "T002", "T003", "T004", "T005"]);
	});

	test("model is always present", async () => {
		const output = await runList(["--job", "test", "--project-root", tmpDir, "--json"]);
		const parsed = JSON.parse(output);
		for (const t of parsed) {
			expect(t.model).toBeDefined();
			expect(typeof t.model).toBe("string");
		}
		const t002 = parsed.find((t: { id: string }) => t.id === "T002");
		expect(t002.model).toBe("claude-opus-4-6");
		const t004 = parsed.find((t: { id: string }) => t.id === "T004");
		expect(t004.model).toBe("claude-sonnet-4-6");
	});

	test("--status filters by single status", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "pending", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(3);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T003", "T004"]);
	});

	test("--status filters by multiple comma-separated statuses", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "pending,failed", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(4);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T003", "T004", "T005"]);
	});

	test("--ready filters to only ready tasks", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(2);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T004"]);
	});

	test("--ready includes correct model assignment", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready", "--json",
		]);
		const parsed = JSON.parse(output);
		const t002 = parsed.find((t: { id: string }) => t.id === "T002");
		expect(t002.model).toBe("claude-opus-4-6");
		expect(t002.complexity).toBe("medium");
		const t004 = parsed.find((t: { id: string }) => t.id === "T004");
		expect(t004.model).toBe("claude-sonnet-4-6");
		expect(t004.complexity).toBe("low");
	});

	test("--after scopes to downstream tasks", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--after", "T001", "--json",
		]);
		const parsed = JSON.parse(output);
		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T003"]);
	});

	test("--after + --ready composes filters", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--after", "T001", "--ready", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].id).toBe("T002");
	});

	test("--include-content adds content field", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "complete", "--include-content", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].id).toBe("T001");
		expect(parsed[0].content).toContain("# T001: Init workspace");
	});

	test("content is absent without --include-content", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "complete", "--json",
		]);
		const parsed = JSON.parse(output);
		expect(parsed[0].content).toBeUndefined();
	});

	test("text output shows one-liner per task", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready",
		]);
		expect(output).toContain("2 task(s):");
		expect(output).toContain("T002: Build foundation [pending] (medium → claude-opus-4-6)");
		expect(output).toContain("T004: Independent task [pending] (low → claude-sonnet-4-6)");
		expect(output).not.toContain("T003");
	});

	test("text output with --include-content shows full content", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "complete", "--include-content",
		]);
		expect(output).toContain("--- T001: Init workspace [complete] ---");
		expect(output).toContain("Task description for T001.");
	});

	test("empty results shows message", async () => {
		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--status", "skipped",
		]);
		expect(output).toContain("No tasks match the given filters.");
	});

	test("--after and --before are mutually exclusive", async () => {
		const origExit = process.exit;
		const origError = console.error;
		let exitCode: number | undefined;
		let errorMsg = "";
		process.exit = ((code: number) => { exitCode = code; }) as never;
		console.error = (...a: unknown[]) => { errorMsg = a.join(" "); };
		try {
			await runList([
				"--job", "test", "--project-root", tmpDir, "--after", "T001", "--before", "T002",
			]);
		} finally {
			process.exit = origExit;
			console.error = origError;
		}
		expect(exitCode).toBe(1);
		expect(errorMsg).toContain("mutually exclusive");
	});

	// Migrated from ready.test.ts
	test("no tasks ready shows message", async () => {
		const allBlockedFixture: TaskGraphData = {
			project: "blocked-project",
			tasks: {
				T001: {
					title: "Blocked task",
					status: "pending",
					dependencies: ["T999"],
					file: "jobs/test/tasks/T001.md",
					complexity: "low",
					attempts: 0,
				},
			},
		};
		const jobDir = join(tmpDir, "jobs", "test");
		await Bun.write(join(jobDir, "task-graph.json"), JSON.stringify(allBlockedFixture, null, 2));

		const output = await runList([
			"--job", "test", "--project-root", tmpDir, "--ready",
		]);
		expect(output).toContain("No tasks match the given filters.");
	});
});
