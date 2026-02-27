import { resolve } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import { autoCommit } from "../core/auto-commit.js";
import { TaskGraph } from "../core/task-graph.js";

export const moveDepsCommand = new Command("move-deps")
  .description("Rewire dependencies from one task to replacement tasks")
  .requiredOption("--from <task-id>", "Task ID to replace in dependency lists")
  .requiredOption("--to <task-ids>", "Comma-separated replacement task IDs")
  .requiredOption("--job <name>", "Job name")
  .option("--project-root <path>", "Project root directory", process.cwd())
  .action(async (opts) => {
    const projectRoot = resolve(opts.projectRoot);
    const { paths } = await requireJobOption(opts.job, projectRoot);
    const tg = await TaskGraph.load(paths.taskGraph);
    const toIds = opts.to
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const affected = tg.dependents(opts.from);
    await tg.moveDeps(opts.from, toIds);
    console.log(
      `Rewired ${affected.length} task(s) from ${opts.from} → ${toIds.join(", ")}`,
    );
    for (const id of affected) {
      console.log(`  Updated: ${id}`);
    }
    await autoCommit(
      [paths.taskGraph],
      `dark-factory: move deps from ${opts.from} to ${toIds.join(",")}`,
      projectRoot,
    );
  });
