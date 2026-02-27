import { Command } from "commander";
import { worktreeCreateCommand } from "./create.js";
import { worktreeListCommand } from "./list.js";
import { worktreeMergeCommand } from "./merge.js";
import { worktreeRemoveCommand } from "./remove.js";

export const worktreeCommand = new Command("worktree")
	.description("Manage git worktrees for tasks")
	.addCommand(worktreeCreateCommand)
	.addCommand(worktreeRemoveCommand)
	.addCommand(worktreeMergeCommand)
	.addCommand(worktreeListCommand);
