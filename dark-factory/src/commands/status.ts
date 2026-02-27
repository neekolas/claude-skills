import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import { TaskGraph } from "../core/task-graph.js";

const STATUS_ICONS: Record<string, string> = {
  complete: "[+]",
  failed: "[x]",
  "in-progress": "[>]",
  skipped: "[-]",
  pending: "[ ]",
};

export const statusCommand = new Command("status")
  .description("Show task graph summary")
  .requiredOption("--job <name>", "Job name")
  .option("--project-root <path>", "Project root directory", process.cwd())
  .option("--json", "Output raw JSON")
  .action(async (opts) => {
    const projectRoot = resolve(opts.projectRoot);
    const { paths } = await requireJobOption(opts.job, projectRoot);
    const tg = await TaskGraph.load(paths.taskGraph);
    const summary = tg.summary();

    if (opts.json) {
      console.log(
        JSON.stringify({ ...summary, remaining: tg.remainingCount() }),
      );
      return;
    }

    console.log(`Project: ${tg.project}`);
    console.log(
      `Total: ${summary.total} | Pending: ${summary.pending} | In Progress: ${summary.in_progress} | Complete: ${summary.complete} | Failed: ${summary.failed}\n`,
    );

    for (const id of tg.allTaskIds()) {
      const task = tg.getTask(id);
      if (!task) continue;
      const icon = STATUS_ICONS[task.status] ?? "[ ]";
      const model = task.complexity === "low" ? "sonnet" : "opus";
      console.log(
        `  ${icon} ${id}: ${task.title} (${task.complexity}, ${model})`,
      );
    }
  });
