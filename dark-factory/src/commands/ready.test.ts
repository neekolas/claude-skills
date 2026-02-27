import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobConfig, TaskGraphData } from "../config/types.js";

// Fixture: T001 complete, T002 depends on T001 (ready, medium),
// T003 depends on T002 (blocked), T004 no deps (ready, low)
const FIXTURE: TaskGraphData = {
	project: "test-ready-project",
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
	tmpDir = await mkdtemp(join(tmpdir(), "df-ready-test-"));
	const jobDir = join(tmpDir, "jobs", "test");
	await mkdir(jobDir, { recursive: true });
	await Bun.write(join(jobDir, "job.json"), JSON.stringify(JOB_CONFIG, null, 2));
	await Bun.write(join(jobDir, "task-graph.json"), JSON.stringify(FIXTURE, null, 2));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function runReady(args: string[]): Promise<string> {
	const { readyCommand } = await import("./ready.js");
	const lines: string[] = [];
	const origLog = console.log;
	console.log = (...a: unknown[]) => lines.push(a.join(" "));
	try {
		await readyCommand.parseAsync(["node", "ready", ...args]);
	} finally {
		console.log = origLog;
	}
	return lines.join("\n");
}

describe("ready command", () => {
	test("--json outputs ready tasks with model assignment", async () => {
		const output = await runReady(["--job", "test", "--project-root", tmpDir, "--json"]);
		const parsed = JSON.parse(output);

		expect(parsed).toBeArray();
		expect(parsed).toHaveLength(2);

		const ids = parsed.map((t: { id: string }) => t.id).sort();
		expect(ids).toEqual(["T002", "T004"]);

		// Model assignment: medium -> opus, low -> sonnet
		const t002 = parsed.find((t: { id: string }) => t.id === "T002");
		expect(t002.model).toBe("claude-opus-4-6");
		expect(t002.complexity).toBe("medium");

		const t004 = parsed.find((t: { id: string }) => t.id === "T004");
		expect(t004.model).toBe("claude-sonnet-4-6");
		expect(t004.complexity).toBe("low");
	});

	test("formatted output lists ready tasks but not blocked ones", async () => {
		const output = await runReady(["--job", "test", "--project-root", tmpDir]);

		// Should show ready tasks
		expect(output).toContain("2 task(s) ready:");
		expect(output).toContain("T002: Build foundation");
		expect(output).toContain("T004: Independent task");

		// Should NOT show blocked task
		expect(output).not.toContain("T003");
		expect(output).not.toContain("Implement feature");

		// Should NOT show completed task
		expect(output).not.toContain("T001");
	});

	test("shows 'no tasks ready' when none available", async () => {
		// Create a fixture where no tasks are ready
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

		const output = await runReady(["--job", "test", "--project-root", tmpDir]);
		expect(output).toContain("No tasks ready for work.");
	});
});
