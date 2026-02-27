#!/usr/bin/env bun
import { Command } from "commander";
import { addDepCommand } from "./commands/add-dep.js";
import { addTaskCommand } from "./commands/add-task.js";
import { currentJobCommand } from "./commands/current-job.js";
import { dependentsCommand } from "./commands/dependents.js";
import { extractTasksCommand } from "./commands/extract-tasks.js";
import { getCommand } from "./commands/get.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { moveDepsCommand } from "./commands/move-deps.js";
import { readyCommand } from "./commands/ready.js";
import { setStatusCommand } from "./commands/set-status.js";
import { statusCommand } from "./commands/status.js";
import { taskStateCommand } from "./commands/task-state.js";
import { worktreeCommand } from "./commands/worktree/index.js";

const program = new Command()
	.name("dark-factory")
	.description("Task orchestration CLI for dark-factory v2")
	.version("2.0.0");

program.addCommand(statusCommand);
program.addCommand(readyCommand);
program.addCommand(getCommand);
program.addCommand(setStatusCommand);
program.addCommand(addTaskCommand);
program.addCommand(addDepCommand);
program.addCommand(dependentsCommand);
program.addCommand(moveDepsCommand);
program.addCommand(taskStateCommand);
program.addCommand(worktreeCommand);
program.addCommand(initCommand);
program.addCommand(extractTasksCommand);
program.addCommand(currentJobCommand);
program.addCommand(listCommand);

program.parse();
