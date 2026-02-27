import { describe, expect, test } from "bun:test";
import { modelForComplexity } from "./model.js";

describe("modelForComplexity", () => {
	test("low complexity returns sonnet", () => {
		expect(modelForComplexity("low")).toBe("claude-sonnet-4-6");
	});

	test("medium complexity returns opus", () => {
		expect(modelForComplexity("medium")).toBe("claude-opus-4-6");
	});

	test("high complexity returns opus", () => {
		expect(modelForComplexity("high")).toBe("claude-opus-4-6");
	});
});
