import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import { TaskGraph } from "../core/task-graph.js";

export const listCommand = new Command("list")
  .description(
    "List tasks upstream or downstream of a given task, with full spec contents",
  )
  .option(
    "--after <task-id>",
    "List all tasks that transitively depend on this task",
  )
  .option(
    "--before <task-id>",
    "List all tasks this task transitively depends on",
  )
  .requiredOption("--job <name>", "Job name")
  .option("--project-root <path>", "Project root directory", process.cwd())
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    if (opts.after && opts.before) {
      console.error("--after and --before are mutually exclusive");
      process.exit(1);
    }
    if (!opts.after && !opts.before) {
      console.error("Provide either --after or --before");
      process.exit(1);
    }

    const projectRoot = resolve(opts.projectRoot);
    const { paths } = await requireJobOption(opts.job, projectRoot);
    const tg = await TaskGraph.load(paths.taskGraph);
    const taskId = opts.after ?? opts.before;
    const taskIds = opts.after
      ? tg.transitiveDownstream(taskId)
      : tg.transitiveUpstream(taskId);

    const results: Array<{
      id: string;
      title: string;
      status: string;
      complexity: string;
      dependencies: string[];
      content: string;
    }> = [];

    for (const id of taskIds) {
      const task = tg.getTask(id);
      if (!task) continue;
      let content = "";
      try {
        content = await readFile(join(projectRoot, task.file), "utf-8");
      } catch {
        content = `[File not found: ${task.file}]`;
      }
      results.push({
        id,
        title: task.title,
        status: task.status,
        complexity: task.complexity,
        dependencies: task.dependencies,
        content,
      });
    }

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      const direction = opts.after ? "after" : "before";
      console.log(`No tasks ${direction} ${taskId}`);
      return;
    }

    for (const r of results) {
      console.log(`--- ${r.id}: ${r.title} [${r.status}] ---`);
      console.log(r.content);
      console.log();
    }
  });
