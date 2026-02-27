import { exec } from "./exec.js";

/**
 * Stage specific files and commit if there are changes.
 * No-op if nothing changed.
 */
export async function autoCommit(files: string[], message: string, cwd?: string): Promise<void> {
	if (files.length === 0) return;

	await exec(["git", "add", ...files], cwd);

	// Check if there's anything staged
	const diff = await exec(["git", "diff", "--cached", "--quiet"], cwd);
	if (diff.ok) return; // nothing staged

	await exec(["git", "commit", "-m", message], cwd);
}
