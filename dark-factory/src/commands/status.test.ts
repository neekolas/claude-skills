import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobConfig, TaskGraphData } from "../config/types.js";

const FIXTURE: TaskGraphData = {
	project: "test-status-project",
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
			status: "in-progress",
			dependencies: ["T001", "T002"],
			file: "jobs/test/tasks/T003.md",
			complexity: "high",
			attempts: 0,
		},
		T004: {
			title: "Independent task",
			status: "failed",
			dependencies: [],
			file: "jobs/test/tasks/T004.md",
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
	tmpDir = await mkdtemp(join(tmpdir(), "df-status-test-"));
	const jobDir = join(tmpDir, "jobs", "test");
	await mkdir(jobDir, { recursive: true });
	await Bun.write(join(jobDir, "job.json"), JSON.stringify(JOB_CONFIG, null, 2));
	await Bun.write(join(jobDir, "task-graph.json"), JSON.stringify(FIXTURE, null, 2));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Helper: run the status command and capture stdout.
 * We import the command and invoke its action programmatically.
 */
async function runStatus(args: string[]): Promise<string> {
	const { statusCommand } = await import("./status.js");
	const lines: string[] = [];
	const origLog = console.log;
	console.log = (...a: unknown[]) => lines.push(a.join(" "));
	try {
		await statusCommand.parseAsync(["node", "status", ...args]);
	} finally {
		console.log = origLog;
	}
	return lines.join("\n");
}

describe("status command", () => {
	test("--json outputs valid summary JSON with correct counts", async () => {
		const output = await runStatus(["--job", "test", "--project-root", tmpDir, "--json"]);
		const parsed = JSON.parse(output);

		expect(parsed.total).toBe(4);
		expect(parsed.pending).toBe(1);
		expect(parsed.in_progress).toBe(1);
		expect(parsed.complete).toBe(1);
		expect(parsed.failed).toBe(1);
		expect(parsed.remaining).toBe(2); // pending + in-progress
	});

	test("formatted output includes project name, task IDs, and titles", async () => {
		const output = await runStatus(["--job", "test", "--project-root", tmpDir]);

		// Project name
		expect(output).toContain("Project: test-status-project");

		// Summary line
		expect(output).toContain("Total: 4");
		expect(output).toContain("Pending: 1");
		expect(output).toContain("Complete: 1");
		expect(output).toContain("Failed: 1");

		// Each task with ID and title
		expect(output).toContain("T001: Init workspace");
		expect(output).toContain("T002: Build foundation");
		expect(output).toContain("T003: Implement feature");
		expect(output).toContain("T004: Independent task");

		// Status icons
		expect(output).toContain("[+] T001"); // complete
		expect(output).toContain("[ ] T002"); // pending
		expect(output).toContain("[>] T003"); // in-progress
		expect(output).toContain("[x] T004"); // failed

		// Complexity and model shown
		expect(output).toContain("(low, sonnet)");
		expect(output).toContain("(medium, opus)");
		expect(output).toContain("(high, opus)");
	});
});
