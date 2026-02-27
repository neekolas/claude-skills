import { rename, writeFile } from "node:fs/promises";
import type {
	ReadyTask,
	SlimTask,
	TaskGraphData,
	TaskStatus,
	TaskSummary,
} from "../config/types.js";

const TERMINAL_STATUSES: TaskStatus[] = ["complete", "failed", "skipped"];

export class TaskGraph {
	private data: TaskGraphData;
	private filePath: string;

	private constructor(data: TaskGraphData, filePath: string) {
		this.data = data;
		this.filePath = filePath;
	}

	static async load(filePath: string): Promise<TaskGraph> {
		const raw = await Bun.file(filePath).text();
		const data = JSON.parse(raw) as TaskGraphData;
		return new TaskGraph(data, filePath);
	}

	private async save(): Promise<void> {
		const tmp = `${this.filePath}.tmp.${Date.now()}`;
		await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
		await rename(tmp, this.filePath);
	}

	get project(): string {
		return this.data.project;
	}

	allTaskIds(): string[] {
		return Object.keys(this.data.tasks).sort();
	}

	getTask(taskId: string): SlimTask | null {
		return this.data.tasks[taskId] ?? null;
	}

	async setStatus(taskId: string, status: TaskStatus): Promise<void> {
		const task = this.data.tasks[taskId];
		if (task) {
			task.status = status;
			await this.save();
		}
	}

	readyTasks(): ReadyTask[] {
		const terminalIds = new Set<string>();
		for (const [id, task] of Object.entries(this.data.tasks)) {
			if (TERMINAL_STATUSES.includes(task.status)) {
				terminalIds.add(id);
			}
		}

		const ready: ReadyTask[] = [];
		for (const [id, task] of Object.entries(this.data.tasks)) {
			if (task.status !== "pending") continue;
			if (!task.dependencies.every((dep) => terminalIds.has(dep))) continue;

			const model = task.complexity === "low" ? "claude-sonnet-4-6" : "claude-opus-4-6";
			ready.push({
				id,
				title: task.title,
				complexity: task.complexity,
				model,
				file: task.file,
			});
		}

		return ready.sort((a, b) => a.id.localeCompare(b.id));
	}

	summary(): TaskSummary {
		const tasks = Object.values(this.data.tasks);
		return {
			total: tasks.length,
			pending: tasks.filter((t) => t.status === "pending").length,
			in_progress: tasks.filter((t) => t.status === "in-progress").length,
			complete: tasks.filter((t) => t.status === "complete").length,
			failed: tasks.filter((t) => t.status === "failed").length,
		};
	}

	remainingCount(): number {
		return Object.values(this.data.tasks).filter((t) => !TERMINAL_STATUSES.includes(t.status))
			.length;
	}

	async resetInterruptedTasks(): Promise<number> {
		let count = 0;
		for (const task of Object.values(this.data.tasks)) {
			if (task.status === "in-progress") {
				task.status = "pending";
				count++;
			}
		}
		if (count > 0) await this.save();
		return count;
	}

	async addTask(taskId: string, task: SlimTask): Promise<void> {
		this.data.tasks[taskId] = task;
		await this.save();
	}

	async amendTask(taskId: string, updates: Partial<SlimTask>): Promise<void> {
		const task = this.data.tasks[taskId];
		if (!task) throw new Error(`Task not found: ${taskId}`);
		Object.assign(task, updates);
		await this.save();
	}

	async incrementAttempts(taskId: string): Promise<void> {
		const task = this.data.tasks[taskId];
		if (!task) throw new Error(`Task not found: ${taskId}`);
		task.attempts += 1;
		await this.save();
	}

	nextTaskId(): string {
		let max = 0;
		for (const id of Object.keys(this.data.tasks)) {
			const num = Number.parseInt(id.replace(/^T/, ""), 10);
			if (num > max) max = num;
		}
		return `T${String(max + 1).padStart(3, "0")}`;
	}

	dependents(taskId: string): string[] {
		const result: string[] = [];
		for (const [id, task] of Object.entries(this.data.tasks)) {
			if (task.dependencies.includes(taskId)) {
				result.push(id);
			}
		}
		return result.sort();
	}

	transitiveDownstream(taskId: string): string[] {
		const visited = new Set<string>();
		const queue = [taskId];
		for (let i = 0; i < queue.length; i++) {
			const current = queue[i];
			for (const [id, task] of Object.entries(this.data.tasks)) {
				if (task.dependencies.includes(current) && !visited.has(id)) {
					visited.add(id);
					queue.push(id);
				}
			}
		}
		return [...visited].sort();
	}

	transitiveUpstream(taskId: string): string[] {
		const visited = new Set<string>();
		const queue = [taskId];
		for (let i = 0; i < queue.length; i++) {
			const current = queue[i];
			const task = this.data.tasks[current];
			if (!task) continue;
			for (const dep of task.dependencies) {
				if (!visited.has(dep)) {
					visited.add(dep);
					queue.push(dep);
				}
			}
		}
		return [...visited].sort();
	}

	async moveDeps(fromTaskId: string, toTaskIds: string[]): Promise<void> {
		for (const task of Object.values(this.data.tasks)) {
			const idx = task.dependencies.indexOf(fromTaskId);
			if (idx === -1) continue;
			task.dependencies.splice(idx, 1, ...toTaskIds);
			// Deduplicate while preserving order
			task.dependencies = [...new Set(task.dependencies)];
		}
		await this.save();
	}

	async addDep(taskId: string, depId: string): Promise<void> {
		const task = this.data.tasks[taskId];
		if (!task) throw new Error(`Task not found: ${taskId}`);
		if (!task.dependencies.includes(depId)) {
			task.dependencies.push(depId);
		}
		await this.save();
	}

	toJSON(): TaskGraphData {
		return structuredClone(this.data);
	}
}
