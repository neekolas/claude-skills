import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobConfig, TaskGraphData } from "../config/types.js";
import { initJob } from "./init.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-init-test-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("initJob", () => {
	test("creates job directory structure", async () => {
		await initJob("my-feature", ["specs/ARCH.md"], tmpDir);
		const jobDir = join(tmpDir, "jobs/my-feature");
		expect((await stat(jobDir)).isDirectory()).toBe(true);
		expect((await stat(join(jobDir, "tasks"))).isDirectory()).toBe(true);
		expect((await stat(join(jobDir, "tasks/output"))).isDirectory()).toBe(true);
	});

	test("writes valid job.json", async () => {
		await initJob("my-feature", ["specs/ARCH.md", "specs/PIPELINE.md"], tmpDir);
		const raw = await readFile(join(tmpDir, "jobs/my-feature/job.json"), "utf-8");
		const config: JobConfig = JSON.parse(raw);
		expect(config.name).toBe("my-feature");
		expect(config.architecture_files).toEqual(["specs/ARCH.md", "specs/PIPELINE.md"]);
		expect(config.task_graph).toBe("jobs/my-feature/task-graph.json");
		expect(config.tasks_dir).toBe("jobs/my-feature/tasks");
		expect(config.output_dir).toBe("jobs/my-feature/tasks/output");
		expect(config.integration_branch).toBe("job/my-feature");
		expect(config.branch_prefix).toBe("df/my-feature/");
		expect(config.model).toBe("claude-opus-4-6");
		expect(config.created_at).toBeDefined();
	});

	test("writes empty task graph", async () => {
		await initJob("my-feature", ["specs/ARCH.md"], tmpDir);
		const raw = await readFile(join(tmpDir, "jobs/my-feature/task-graph.json"), "utf-8");
		const graph: TaskGraphData = JSON.parse(raw);
		expect(graph.project).toBe("my-feature");
		expect(graph.tasks).toEqual({});
	});

	test("sanitizes job name", async () => {
		await initJob("My Cool Feature!", ["specs/ARCH.md"], tmpDir);
		const jobDir = join(tmpDir, "jobs/my-cool-feature");
		expect((await stat(jobDir)).isDirectory()).toBe(true);
	});

	test("throws if job already exists", async () => {
		await initJob("my-feature", ["specs/ARCH.md"], tmpDir);
		expect(initJob("my-feature", ["specs/ARCH.md"], tmpDir)).rejects.toThrow("already exists");
	});

	test("returns sanitized name and job dir", async () => {
		const result = await initJob("My Feature", ["specs/ARCH.md"], tmpDir);
		expect(result.name).toBe("my-feature");
		expect(result.jobDir).toBe(join(tmpDir, "jobs/my-feature"));
	});
});
