import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import { TaskGraph } from "../core/task-graph.js";

export const dependentsCommand = new Command("dependents")
  .description("List tasks that depend on a given task")
  .argument("<task-id>", "Task ID to find dependents of")
  .requiredOption("--job <name>", "Job name")
  .option("--project-root <path>", "Project root directory", process.cwd())
  .option("--json", "Output as JSON")
  .action(async (taskId, opts) => {
    const projectRoot = resolve(opts.projectRoot);
    const { paths } = await requireJobOption(opts.job, projectRoot);
    const tg = await TaskGraph.load(paths.taskGraph);
    const deps = tg.dependents(taskId);

    if (opts.json) {
      console.log(JSON.stringify(deps));
      return;
    }

    if (deps.length === 0) {
      console.log(`No tasks depend on ${taskId}`);
      return;
    }

    console.log(`Tasks depending on ${taskId}:`);
    for (const id of deps) {
      const task = tg.getTask(id);
      console.log(`  ${id}: ${task?.title ?? id}`);
    }
  });
