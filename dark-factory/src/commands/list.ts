import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import type { ListTask, TaskStatus } from "../config/types.js";
import { modelForComplexity } from "../core/model.js";
import { TaskGraph } from "../core/task-graph.js";

export const listCommand = new Command("list")
	.description("List tasks with composable filters")
	.option("--after <task-id>", "Scope to tasks that transitively depend on this task")
	.option("--before <task-id>", "Scope to tasks this task transitively depends on")
	.option("--ready", "Filter to only tasks ready for work")
	.option("--status <statuses>", "Filter by status (comma-separated)")
	.option("--include-content", "Include markdown file content in output")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.option("--json", "Output as JSON")
	.action(async (opts) => {
		if (opts.after && opts.before) {
			console.error("--after and --before are mutually exclusive");
			process.exit(1);
		}

		const projectRoot = resolve(opts.projectRoot);
		const { paths } = await requireJobOption(opts.job, projectRoot);
		const tg = await TaskGraph.load(paths.taskGraph);

		// 1. Base set: scoped by --after/--before, or all tasks
		let taskIds: string[];
		if (opts.after) {
			taskIds = tg.transitiveDownstream(opts.after);
		} else if (opts.before) {
			taskIds = tg.transitiveUpstream(opts.before);
		} else {
			taskIds = tg.allTaskIds();
		}

		// 2. Filter by --status
		if (opts.status) {
			const statuses = new Set(opts.status.split(",") as TaskStatus[]);
			taskIds = taskIds.filter((id) => {
				const task = tg.getTask(id);
				return task && statuses.has(task.status);
			});
		}

		// 3. Filter by --ready
		if (opts.ready) {
			const readyIds = tg.readyTaskIds();
			taskIds = taskIds.filter((id) => readyIds.has(id));
		}

		// 4. Build results
		const results: ListTask[] = [];
		for (const id of taskIds) {
			const task = tg.getTask(id);
			if (!task) continue;

			const entry: ListTask = {
				id,
				title: task.title,
				status: task.status,
				complexity: task.complexity,
				model: modelForComplexity(task.complexity),
				dependencies: task.dependencies,
			};

			if (opts.includeContent) {
				try {
					entry.content = await readFile(join(projectRoot, task.file), "utf-8");
				} catch {
					entry.content = `[File not found: ${task.file}]`;
				}
			}

			results.push(entry);
		}

		// 5. Output
		if (opts.json) {
			console.log(JSON.stringify(results, null, 2));
			return;
		}

		if (results.length === 0) {
			console.log("No tasks match the given filters.");
			return;
		}

		if (opts.includeContent) {
			for (const r of results) {
				console.log(`--- ${r.id}: ${r.title} [${r.status}] ---`);
				console.log(r.content);
				console.log();
			}
		} else {
			console.log(`${results.length} task(s):\n`);
			for (const r of results) {
				console.log(`  ${r.id}: ${r.title} [${r.status}] (${r.complexity} → ${r.model})`);
			}
		}
	});
