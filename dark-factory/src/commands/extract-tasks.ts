import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { requireJobOption } from "../config/job.js";
import type { Complexity, TaskGraphData } from "../config/types.js";
import { autoCommit } from "../core/auto-commit.js";
import { exec } from "../core/exec.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface ExtractedTask {
	id: string;
	title: string;
	description: string;
	dependencies: string[];
	files: string[];
	acceptance_criteria: string;
	verification_steps: string[];
	context_files: string[];
	estimated_complexity: Complexity;
	implementation_details: string;
}

export interface ExtractionResult {
	project: string;
	tasks: ExtractedTask[];
}

// ── Prompt ───────────────────────────────────────────────────────────────

export function buildExtractionPrompt(outputPath: string): string {
	return `You are extracting a task list from architecture document(s).

Read the provided document(s) and extract every implementation task as structured JSON.

Write the result as valid JSON to this file: ${outputPath}

Use this exact schema:
{
  "project": "<project name>",
  "tasks": [
    {
      "id": "T001",
      "title": "Short task title",
      "description": "Detailed description of what to implement",
      "dependencies": ["T000"],
      "files": ["src/path/to/file.ts"],
      "acceptance_criteria": "Specific, verifiable criteria",
      "verification_steps": ["cargo build", "bun test"],
      "context_files": ["specs/ARCHITECTURE.md"],
      "estimated_complexity": "low|medium|high",
      "implementation_details": "Markdown with ### headers covering patterns, integration points, edge cases"
    }
  ]
}

Rules:
- Extract EVERY task mentioned in the document
- Use sequential IDs (T001, T002, ...)
- Dependencies must reference valid task IDs within the list
- Be specific about files and acceptance criteria

Rules for implementation_details (IMPORTANT — this is the most valuable field):
- Write as if briefing a senior developer who has never seen the codebase
- Reference specific sections, patterns, or code examples from the architecture document(s)
- Include: function signatures, struct/type definitions, trait impls, or API shapes needed
- Include: integration points — what existing modules/functions this code must connect to
- Include: edge cases, error handling requirements, and known gotchas
- Include: example code snippets showing expected output patterns when the docs provide them
- Format as markdown with headers (### Pattern, ### Integration Points, ### Edge Cases, etc.)
- Each task's details must be self-contained — workers see ONLY their task, not the full architecture
- Scale detail to complexity: ~50-100 words for low, ~100-200 for medium, ~200-400 for high

CRITICAL: After writing the file, read it back and validate it parses as valid JSON. If it doesn't, fix it and re-write the file. Do not finish until ${outputPath} contains valid JSON matching the schema above.`;
}

// ── Parsing ──────────────────────────────────────────────────────────────

/**
 * Read and parse the extraction result from a JSON file written by Claude.
 */
export async function readExtractionFile(filePath: string): Promise<ExtractionResult> {
	const raw = await readFile(filePath, "utf-8");
	return JSON.parse(raw) as ExtractionResult;
}

// ── Write task files ─────────────────────────────────────────────────────

/**
 * Write task markdown files and the slim JSON graph from an extraction result.
 *
 * Unlike the old writeTaskFiles, this writes to job-specific directories
 * and uses relative paths within the job for the graph's `file` field.
 */
export async function writeJobTaskFiles(
	extraction: ExtractionResult,
	tasksDir: string,
	graphPath: string,
	relativeTasksDir: string,
): Promise<{ taskCount: number }> {
	await mkdir(tasksDir, { recursive: true });

	for (const t of extraction.tasks) {
		const filePath = join(tasksDir, `${t.id}.md`);
		const content = `# ${t.id}: ${t.title}

**Dependencies**: ${t.dependencies.length > 0 ? t.dependencies.join(", ") : "None"}
**Estimated Complexity**: ${t.estimated_complexity.charAt(0).toUpperCase() + t.estimated_complexity.slice(1)}

## Description
${t.description}

## Files Created/Modified
${t.files.map((f) => `- \`${f}\``).join("\n")}

## Implementation Details
${t.implementation_details}

## Acceptance Criteria
${t.acceptance_criteria}

## Verification Steps
${t.verification_steps.map((s) => `- [ ] ${s}`).join("\n")}

## Context Files
${t.context_files.map((f) => `- \`${f}\``).join("\n")}
`;
		await writeFile(filePath, content);
	}

	// Create slim JSON graph
	await mkdir(dirname(graphPath), { recursive: true });

	const graph: TaskGraphData = {
		project: extraction.project,
		tasks: Object.fromEntries(
			extraction.tasks.map((t) => [
				t.id,
				{
					title: t.title,
					status: "pending" as const,
					dependencies: t.dependencies,
					file: `${relativeTasksDir}/${t.id}.md`,
					complexity: t.estimated_complexity,
					attempts: 0,
				},
			]),
		),
	};

	await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);

	return { taskCount: extraction.tasks.length };
}

// ── Command ──────────────────────────────────────────────────────────────

export const extractTasksCommand = new Command("extract-tasks")
	.description(
		"Extract tasks from architecture files using Claude and write them to the job's tasks directory",
	)
	.requiredOption("--job <name>", "Job name")
	.option("--model <model>", "Claude model to use")
	.option("--dry-run", "Print extracted tasks without writing files")
	.option("--project-root <path>", "Project root directory", process.cwd())
	.action(async (opts) => {
		const projectRoot: string = opts.projectRoot;
		const { job, paths } = await requireJobOption(opts.job, projectRoot);

		const model = opts.model || job.model || "claude-opus-4-6";

		// Read architecture files
		const archContents: string[] = [];
		for (const archFile of job.architecture_files) {
			const absPath = join(projectRoot, archFile);
			const content = await readFile(absPath, "utf-8");
			archContents.push(`--- ${archFile} ---\n${content}`);
		}
		const combinedArch = archContents.join("\n\n");

		// Create temp file for Claude to write JSON into
		const tmpDir = await mkdtemp(join(tmpdir(), "df-extract-"));
		const outputPath = join(tmpDir, "extraction.json");

		try {
			// Call Claude for extraction — it writes result to outputPath
			const prompt = `${buildExtractionPrompt(outputPath)}\n\n${combinedArch}`;
			const result = await exec(
				["claude", "--print", "--model", model, "--max-turns", "150", prompt],
				projectRoot,
			);
			if (!result.ok) {
				console.error(`Claude extraction failed:\n${result.stderr}`);
				process.exit(1);
			}

			const extraction = await readExtractionFile(outputPath);

			if (opts.dryRun) {
				console.log(`Extracted ${extraction.tasks.length} tasks:`);
				for (const t of extraction.tasks) {
					const deps = t.dependencies.length > 0 ? ` (deps: ${t.dependencies.join(", ")})` : "";
					console.log(`  ${t.id}: ${t.title}${deps} [${t.estimated_complexity}]`);
				}
				return;
			}

			// Write task files
			const { taskCount } = await writeJobTaskFiles(
				extraction,
				paths.tasksDir,
				paths.taskGraph,
				job.tasks_dir,
			);

			// Collect written files for auto-commit
			const writtenFiles = [
				paths.taskGraph,
				...extraction.tasks.map((t) => join(paths.tasksDir, `${t.id}.md`)),
			];
			await autoCommit(
				writtenFiles,
				`feat: extract ${taskCount} tasks for job "${job.name}"`,
				projectRoot,
			);

			console.log(`Extracted ${taskCount} tasks for job "${job.name}"`);
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
