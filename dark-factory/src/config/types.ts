export type TaskStatus = "pending" | "in-progress" | "complete" | "failed" | "skipped";
export type Complexity = "low" | "medium" | "high";

// Recovery state machine (derived from durable artifacts, not stored)
export type TaskState =
	| "pending" // No worktree
	| "worktree-created" // Worktree exists, no scaffolds
	| "scaffolding" // Test sub-agent running (no marker yet)
	| "scaffolded" // .df-scaffolds-ready exists
	| "executing" // Implementation sub-agent running
	| "evaluating" // Result file exists
	| "complete"
	| "failed";

// Slim task in JSON graph (pointer to markdown file)
export interface SlimTask {
	title: string;
	status: TaskStatus;
	dependencies: string[];
	file: string; // relative path to specs/tasks/TXXX.md
	complexity: Complexity;
	attempts: number;
}

export interface TaskGraphData {
	project: string;
	tasks: Record<string, SlimTask>;
}

export interface TaskSummary {
	total: number;
	pending: number;
	in_progress: number;
	complete: number;
	failed: number;
}

// Model assignment for ready command
export interface ReadyTask {
	id: string;
	title: string;
	complexity: Complexity;
	model: string;
	file: string;
}

// Worktree config
export interface WorktreeConfig {
	projectRoot: string;
	worktreeBase: string;
	branchPrefix: string;
	integrationBranch: string;
}

// Job config (persisted as jobs/<name>/job.json)
export interface JobConfig {
	name: string;
	architecture_files: string[];
	task_graph: string;
	tasks_dir: string;
	output_dir: string;
	integration_branch: string;
	worktree_base: string;
	branch_prefix: string;
	model: string;
	created_at: string;
}
