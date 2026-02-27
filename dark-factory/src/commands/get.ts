import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import { TaskGraph } from "../core/task-graph.js";

export const getCommand = new Command("get")
  .description("Print task file contents")
  .argument("<task-id>", "Task ID (e.g. T001)")
  .requiredOption("--job <name>", "Job name")
  .option("--project-root <path>", "Project root directory", process.cwd())
  .action(async (taskId, opts) => {
    const projectRoot = resolve(opts.projectRoot);
    const { paths } = await requireJobOption(opts.job, projectRoot);
    const tg = await TaskGraph.load(paths.taskGraph);
    const task = tg.getTask(taskId);
    if (!task) {
      console.error(`Task ${taskId} not found`);
      process.exit(1);
    }
    const content = await readFile(join(projectRoot, task.file), "utf-8");
    console.log(content);
  });
