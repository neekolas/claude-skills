import { Command } from "commander";
import { exec } from "../core/exec.js";

const JOB_BRANCH_RE = /^job\/(.+)$/;

export function parseJobFromBranch(branch: string): string | null {
  const match = branch.match(JOB_BRANCH_RE);
  if (!match || !match[1]) return null;
  return match[1];
}

export const currentJobCommand = new Command("current-job")
  .description("Print the current job name from the git branch")
  .action(async () => {
    const result = await exec(["git", "branch", "--show-current"]);
    if (!result.ok) {
      console.error("Failed to determine current branch");
      process.exit(1);
    }

    const branch = result.output.trim();
    const jobName = parseJobFromBranch(branch);

    if (!jobName) {
      console.error(
        `Error: Not on a job branch. Current branch: ${branch}\nExpected branch pattern: job/<job-name>\n\nTo list available jobs, check the jobs/ directory.`,
      );
      process.exit(1);
    }

    console.log(jobName);
  });
