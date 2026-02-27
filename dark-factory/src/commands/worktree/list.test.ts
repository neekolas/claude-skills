import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { JobConfig } from "../../config/types.js";
import { listWorktrees } from "./list.js";

let tmpDir: string;
let worktreeBase: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-worktree-list-test-"));
	worktreeBase = join(tmpDir, "worktrees");
	await mkdir(worktreeBase, { recursive: true });
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("listWorktrees", () => {
	test("returns empty array when no directories exist", async () => {
		const result = await listWorktrees(worktreeBase);
		expect(result).toEqual([]);
	});

	test("returns empty array when worktree base does not exist", async () => {
		const result = await listWorktrees(join(tmpDir, "nonexistent"));
		expect(result).toEqual([]);
	});

	test("returns task IDs for matching directories", async () => {
		await mkdir(join(worktreeBase, "T001"));
		await mkdir(join(worktreeBase, "T002"));
		await mkdir(join(worktreeBase, "T010"));

		const result = await listWorktrees(worktreeBase);
		expect(result).toEqual(["T001", "T002", "T010"]);
	});

	test("ignores non-task-ID directories", async () => {
		await mkdir(join(worktreeBase, "T001"));
		await mkdir(join(worktreeBase, "not-a-task"));
		await mkdir(join(worktreeBase, ".hidden"));
		await mkdir(join(worktreeBase, "readme"));

		const result = await listWorktrees(worktreeBase);
		expect(result).toEqual(["T001"]);
	});

	test("ignores files that match task ID pattern", async () => {
		await mkdir(join(worktreeBase, "T001"));
		await writeFile(join(worktreeBase, "T002"), "not a directory");

		const result = await listWorktrees(worktreeBase);
		expect(result).toEqual(["T001"]);
	});

	test("returns sorted task IDs", async () => {
		await mkdir(join(worktreeBase, "T010"));
		await mkdir(join(worktreeBase, "T001"));
		await mkdir(join(worktreeBase, "T005"));

		const result = await listWorktrees(worktreeBase);
		expect(result).toEqual(["T001", "T005", "T010"]);
	});
});

describe("worktree list CLI", () => {
	let projectRoot: string;

	const JOB_CONFIG: JobConfig = {
		name: "test",
		architecture_files: [],
		task_graph: "jobs/test/task-graph.json",
		tasks_dir: "jobs/test/tasks",
		output_dir: "jobs/test/tasks/output",
		integration_branch: "develop",
		worktree_base: "",
		branch_prefix: "df/test/",
		model: "claude-opus-4-6",
		created_at: "2026-01-01T00:00:00Z",
	};

	beforeEach(async () => {
		projectRoot = join(tmpDir, "project");
		const jobDir = join(projectRoot, "jobs", "test");
		await mkdir(jobDir, { recursive: true });

		// worktree_base is relative to projectRoot; point it at our test worktreeBase
		// Since worktreeBase = tmpDir/worktrees and projectRoot = tmpDir/project,
		// the relative path is ../worktrees
		const config = { ...JOB_CONFIG, worktree_base: "../worktrees" };
		await Bun.write(join(jobDir, "job.json"), JSON.stringify(config, null, 2));
	});

	async function runWorktreeList(
		args: string[],
	): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
		const { worktreeListCommand } = await import("./list.js");
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
			await worktreeListCommand.parseAsync(["node", "list", ...args]);
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

	test("prints 'No active worktrees' when empty", async () => {
		const result = await runWorktreeList(["--job", "test", "--project-root", projectRoot]);
		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("No active worktrees");
	});

	test("lists task IDs when worktrees exist", async () => {
		await mkdir(join(worktreeBase, "T001"));
		await mkdir(join(worktreeBase, "T003"));

		const result = await runWorktreeList(["--job", "test", "--project-root", projectRoot]);
		expect(result.exitCode).toBeNull();
		expect(result.stdout).toContain("T001");
		expect(result.stdout).toContain("T003");
	});

	test("--json outputs valid JSON with tasks array", async () => {
		await mkdir(join(worktreeBase, "T001"));
		await mkdir(join(worktreeBase, "T002"));

		const result = await runWorktreeList([
			"--job",
			"test",
			"--project-root",
			projectRoot,
			"--json",
		]);
		expect(result.exitCode).toBeNull();
		const parsed = JSON.parse(result.stdout);
		expect(parsed.worktreeBase).toBe(resolve(projectRoot, "../worktrees"));
		expect(parsed.tasks).toEqual(["T001", "T002"]);
	});
});
