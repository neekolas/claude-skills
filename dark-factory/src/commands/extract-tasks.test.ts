import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskGraphData } from "../config/types.js";
import { type ExtractionResult, readExtractionFile, writeJobTaskFiles } from "./extract-tasks.js";

const SAMPLE_EXTRACTION: ExtractionResult = {
	project: "my-feature",
	tasks: [
		{
			id: "T001",
			title: "Set up workspace",
			description: "Initialize the project workspace.",
			dependencies: [],
			files: ["src/init.ts"],
			acceptance_criteria: "Workspace exists",
			verification_steps: ["bun test"],
			context_files: ["specs/ARCH.md"],
			estimated_complexity: "low",
			implementation_details: "### Pattern\nUse mkdirSync.",
		},
		{
			id: "T002",
			title: "Build core",
			description: "Build the core module.",
			dependencies: ["T001"],
			files: ["src/core.ts"],
			acceptance_criteria: "Tests pass",
			verification_steps: ["bun test"],
			context_files: [],
			estimated_complexity: "high",
			implementation_details: "### Pattern\nPipeline architecture.",
		},
	],
};

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-extract-test-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("readExtractionFile", () => {
	test("reads and parses JSON from file", async () => {
		const filePath = join(tmpDir, "extraction.json");
		await writeFile(filePath, JSON.stringify(SAMPLE_EXTRACTION));
		const result = await readExtractionFile(filePath);
		expect(result.project).toBe("my-feature");
		expect(result.tasks).toHaveLength(2);
	});

	test("throws on invalid JSON in file", async () => {
		const filePath = join(tmpDir, "bad.json");
		await writeFile(filePath, "not json");
		expect(readExtractionFile(filePath)).rejects.toThrow();
	});

	test("throws if file does not exist", () => {
		expect(readExtractionFile(join(tmpDir, "missing.json"))).rejects.toThrow();
	});
});

describe("writeJobTaskFiles", () => {
	test("writes task markdown files to job tasks dir", async () => {
		const tasksDir = join(tmpDir, "jobs/my-feature/tasks");
		const graphPath = join(tmpDir, "jobs/my-feature/task-graph.json");
		await mkdir(tasksDir, { recursive: true });

		await writeJobTaskFiles(SAMPLE_EXTRACTION, tasksDir, graphPath, "jobs/my-feature/tasks");

		const t001 = await readFile(join(tasksDir, "T001.md"), "utf-8");
		expect(t001).toContain("# T001: Set up workspace");
		expect(t001).toContain("**Dependencies**: None");

		const t002 = await readFile(join(tasksDir, "T002.md"), "utf-8");
		expect(t002).toContain("# T002: Build core");
		expect(t002).toContain("**Dependencies**: T001");
	});

	test("writes task graph with job-relative file paths", async () => {
		const tasksDir = join(tmpDir, "jobs/my-feature/tasks");
		const graphPath = join(tmpDir, "jobs/my-feature/task-graph.json");
		await mkdir(tasksDir, { recursive: true });

		await writeJobTaskFiles(SAMPLE_EXTRACTION, tasksDir, graphPath, "jobs/my-feature/tasks");

		const raw = await readFile(graphPath, "utf-8");
		const graph: TaskGraphData = JSON.parse(raw);

		expect(graph.project).toBe("my-feature");
		expect(graph.tasks.T001.file).toBe("jobs/my-feature/tasks/T001.md");
		expect(graph.tasks.T001.status).toBe("pending");
		expect(graph.tasks.T001.attempts).toBe(0);
		expect(graph.tasks.T002.dependencies).toEqual(["T001"]);
	});

	test("returns task count", async () => {
		const tasksDir = join(tmpDir, "jobs/my-feature/tasks");
		const graphPath = join(tmpDir, "jobs/my-feature/task-graph.json");
		await mkdir(tasksDir, { recursive: true });

		const result = await writeJobTaskFiles(
			SAMPLE_EXTRACTION,
			tasksDir,
			graphPath,
			"jobs/my-feature/tasks",
		);
		expect(result.taskCount).toBe(2);
	});
});
