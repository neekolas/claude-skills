/**
 * Shared helper for running subprocesses via Bun.spawn.
 * Used by worktree, worker, discovery, and scheduler modules.
 */
export interface ExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	output: string;
}

export async function exec(cmd: string[], cwd?: string): Promise<ExecResult> {
	const proc = Bun.spawn(cmd, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { ok: exitCode === 0, stdout, stderr, output: stdout + stderr };
}
