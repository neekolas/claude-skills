import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskGraphData } from "../config/types.js";
import { TaskGraph } from "./task-graph.js";

const FIXTURE: TaskGraphData = {
	project: "test-project",
	tasks: {
		T001: {
			title: "Init workspace",
			status: "complete",
			dependencies: [],
			file: "specs/tasks/T001.md",
			complexity: "low",
			attempts: 0,
		},
		T002: {
			title: "Build foundation",
			status: "pending",
			dependencies: ["T001"],
			file: "specs/tasks/T002.md",
			complexity: "medium",
			attempts: 0,
		},
		T003: {
			title: "Implement feature",
			status: "pending",
			dependencies: ["T001", "T002"],
			file: "specs/tasks/T003.md",
			complexity: "high",
			attempts: 0,
		},
		T004: {
			title: "Independent task",
			status: "pending",
			dependencies: [],
			file: "specs/tasks/T004.md",
			complexity: "low",
			attempts: 0,
		},
	},
};

let tmpDir: string;
let graphPath: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "df-test-"));
	graphPath = join(tmpDir, "task-graph.json");
	await Bun.write(graphPath, JSON.stringify(FIXTURE, null, 2));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("TaskGraph", () => {
	test("load and basic accessors", async () => {
		const tg = await TaskGraph.load(graphPath);
		expect(tg.project).toBe("test-project");
		expect(tg.getTask("T001")?.title).toBe("Init workspace");
		expect(tg.getTask("T999")).toBeNull();
		expect(tg.allTaskIds()).toEqual(["T001", "T002", "T003", "T004"]);
	});

	test("setStatus persists to disk", async () => {
		const tg = await TaskGraph.load(graphPath);
		await tg.setStatus("T002", "in-progress");

		const tg2 = await TaskGraph.load(graphPath);
		expect(tg2.getTask("T002")?.status).toBe("in-progress");
	});

	test("readyTasks returns pending tasks with all deps complete", async () => {
		const tg = await TaskGraph.load(graphPath);
		const ready = tg.readyTasks();

		// T002 depends on T001(complete) → ready
		// T003 depends on T001(complete) + T002(pending) → not ready
		// T004 has no deps → ready
		const ids = ready.map((r) => r.id).sort();
		expect(ids).toEqual(["T002", "T004"]);

		// Verify model assignment: low → claude-sonnet-4-6, medium → claude-opus-4-6
		const t002 = ready.find((r) => r.id === "T002");
		expect(t002?.model).toBe("claude-opus-4-6");
		const t004 = ready.find((r) => r.id === "T004");
		expect(t004?.model).toBe("claude-sonnet-4-6");
	});

	test("readyTasks updates after status change", async () => {
		const tg = await TaskGraph.load(graphPath);

		// Complete T002 → T003 should become ready
		await tg.setStatus("T002", "complete");
		const ready = tg.readyTasks();
		const ids = ready.map((r) => r.id).sort();
		expect(ids).toEqual(["T003", "T004"]);
	});

	test("summary counts", async () => {
		const tg = await TaskGraph.load(graphPath);
		expect(tg.summary()).toEqual({
			total: 4,
			pending: 3,
			in_progress: 0,
			complete: 1,
			failed: 0,
		});
	});

	test("remainingCount excludes terminal states", async () => {
		const tg = await TaskGraph.load(graphPath);
		expect(tg.remainingCount()).toBe(3);

		await tg.setStatus("T002", "failed");
		expect(tg.remainingCount()).toBe(2);

		await tg.setStatus("T004", "skipped");
		expect(tg.remainingCount()).toBe(1);
	});

	test("resetInterruptedTasks", async () => {
		const tg = await TaskGraph.load(graphPath);
		await tg.setStatus("T002", "in-progress");
		await tg.setStatus("T003", "in-progress");

		const count = await tg.resetInterruptedTasks();
		expect(count).toBe(2);
		expect(tg.getTask("T002")?.status).toBe("pending");
		expect(tg.getTask("T003")?.status).toBe("pending");

		// Verify persisted
		const tg2 = await TaskGraph.load(graphPath);
		expect(tg2.getTask("T002")?.status).toBe("pending");
	});

	test("addTask creates new entry", async () => {
		const tg = await TaskGraph.load(graphPath);
		await tg.addTask("T005", {
			title: "New task",
			status: "pending",
			dependencies: ["T001"],
			file: "specs/tasks/T005.md",
			complexity: "low",
			attempts: 0,
		});

		expect(tg.getTask("T005")?.title).toBe("New task");

		// Verify persisted
		const tg2 = await TaskGraph.load(graphPath);
		expect(tg2.getTask("T005")?.title).toBe("New task");
	});

	test("amendTask merges without clobbering", async () => {
		const tg = await TaskGraph.load(graphPath);
		await tg.amendTask("T003", { title: "Updated feature" });
		expect(tg.getTask("T003")?.title).toBe("Updated feature");
		// Other fields preserved
		expect(tg.getTask("T003")?.complexity).toBe("high");
		expect(tg.getTask("T003")?.dependencies).toEqual(["T001", "T002"]);
	});

	test("incrementAttempts", async () => {
		const tg = await TaskGraph.load(graphPath);
		expect(tg.getTask("T002")?.attempts).toBe(0);

		await tg.incrementAttempts("T002");
		expect(tg.getTask("T002")?.attempts).toBe(1);

		await tg.incrementAttempts("T002");
		expect(tg.getTask("T002")?.attempts).toBe(2);

		// Verify persisted
		const tg2 = await TaskGraph.load(graphPath);
		expect(tg2.getTask("T002")?.attempts).toBe(2);
	});

	test("nextTaskId", async () => {
		const tg = await TaskGraph.load(graphPath);
		expect(tg.nextTaskId()).toBe("T005");

		await tg.addTask("T005", {
			title: "Five",
			status: "pending",
			dependencies: [],
			file: "specs/tasks/T005.md",
			complexity: "low",
			attempts: 0,
		});
		expect(tg.nextTaskId()).toBe("T006");
	});

	test("dependents returns tasks that depend on given task", async () => {
		const tg = await TaskGraph.load(graphPath);

		// T001 is depended on by T002 and T003
		expect(tg.dependents("T001").sort()).toEqual(["T002", "T003"]);
		// T002 is depended on by T003
		expect(tg.dependents("T002")).toEqual(["T003"]);
		// T004 has no dependents
		expect(tg.dependents("T004")).toEqual([]);
	});

	test("moveDeps rewires dependencies", async () => {
		const tg = await TaskGraph.load(graphPath);

		// Replace T001 with T005 and T006 in all dependency lists
		await tg.addTask("T005", {
			title: "Split A",
			status: "complete",
			dependencies: [],
			file: "specs/tasks/T005.md",
			complexity: "low",
			attempts: 0,
		});
		await tg.addTask("T006", {
			title: "Split B",
			status: "complete",
			dependencies: [],
			file: "specs/tasks/T006.md",
			complexity: "low",
			attempts: 0,
		});

		await tg.moveDeps("T001", ["T005", "T006"]);

		// T002 depended on T001 → now depends on T005, T006
		expect(tg.getTask("T002")?.dependencies.sort()).toEqual(["T005", "T006"]);
		// T003 depended on T001, T002 → now depends on T002, T005, T006
		expect(tg.getTask("T003")?.dependencies.sort()).toEqual(["T002", "T005", "T006"]);
		// T004 had no deps → still no deps
		expect(tg.getTask("T004")?.dependencies).toEqual([]);
	});

	test("addDep adds a single dependency", async () => {
		const tg = await TaskGraph.load(graphPath);

		await tg.addDep("T004", "T002");
		expect(tg.getTask("T004")?.dependencies).toEqual(["T002"]);

		// Verify persisted
		const tg2 = await TaskGraph.load(graphPath);
		expect(tg2.getTask("T004")?.dependencies).toEqual(["T002"]);
	});

	test("transitiveDownstream returns all transitive dependents", async () => {
		const tg = await TaskGraph.load(graphPath);

		// T001 → T002 → T003, and T001 → T003 directly
		// So downstream of T001 = [T002, T003]
		expect(tg.transitiveDownstream("T001")).toEqual(["T002", "T003"]);

		// T002 → T003 only
		expect(tg.transitiveDownstream("T002")).toEqual(["T003"]);

		// T003 has no dependents
		expect(tg.transitiveDownstream("T003")).toEqual([]);

		// T004 is isolated
		expect(tg.transitiveDownstream("T004")).toEqual([]);
	});

	test("transitiveUpstream returns all transitive dependencies", async () => {
		const tg = await TaskGraph.load(graphPath);

		// T003 depends on T001 and T002; T002 depends on T001
		// So upstream of T003 = [T001, T002]
		expect(tg.transitiveUpstream("T003")).toEqual(["T001", "T002"]);

		// T002 depends on T001
		expect(tg.transitiveUpstream("T002")).toEqual(["T001"]);

		// T001 has no deps
		expect(tg.transitiveUpstream("T001")).toEqual([]);

		// T004 has no deps
		expect(tg.transitiveUpstream("T004")).toEqual([]);
	});
});
