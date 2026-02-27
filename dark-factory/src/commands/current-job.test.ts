import { describe, expect, test } from "bun:test";
import { parseJobFromBranch } from "./current-job.js";

describe("parseJobFromBranch", () => {
	test("extracts job name from job/ branch", () => {
		expect(parseJobFromBranch("job/my-feature")).toBe("my-feature");
	});

	test("handles hyphenated names", () => {
		expect(parseJobFromBranch("job/add-auth-system")).toBe("add-auth-system");
	});

	test("returns null for non-job branches", () => {
		expect(parseJobFromBranch("main")).toBeNull();
		expect(parseJobFromBranch("develop")).toBeNull();
		expect(parseJobFromBranch("df/T001")).toBeNull();
		expect(parseJobFromBranch("feature/something")).toBeNull();
	});

	test("returns null for job/ prefix with no name", () => {
		expect(parseJobFromBranch("job/")).toBeNull();
	});
});
