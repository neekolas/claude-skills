import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import { TaskGraph } from "../core/task-graph.js";

export const readyCommand = new Command("ready")
	.description("List tasks ready for work (all dependencies satisfied)")
	.requiredOption("--job <name>", "Job name")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.option("--json", "Output as JSON")
	.action(async (opts) => {
		const projectRoot = resolve(opts.projectRoot);
		const { paths } = await requireJobOption(opts.job, projectRoot);
		const tg = await TaskGraph.load(paths.taskGraph);
		const ready = tg.readyTasks();

		if (opts.json) {
			console.log(JSON.stringify(ready));
			return;
		}

		if (ready.length === 0) {
			console.log("No tasks ready for work.");
			return;
		}

		console.log(`${ready.length} task(s) ready:\n`);
		for (const t of ready) {
			console.log(`  ${t.id}: ${t.title} (${t.complexity} → ${t.model})`);
		}
	});
