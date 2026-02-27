import { describe, expect, test } from "bun:test";
import { Logger } from "./logger.js";

describe("Logger", () => {
	test.each([
		[0, "00:00:00"],
		[61, "00:01:01"],
		[3661, "01:01:01"],
	])("formatElapsed(%i) = %s", (input, expected) => {
		// biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
		expect((new Logger() as any).formatElapsed(input)).toBe(expected);
	});

	test.each([
		["log", "", /^\[\d{2}:\d{2}:\d{2}\] hello$/],
		["ok", "", /^\[\d{2}:\d{2}:\d{2}\] OK: hello$/],
		["warn", "", /^\[\d{2}:\d{2}:\d{2}\] WARN: hello$/],
	] as const)("%s() writes to stdout with correct prefix", (method, _, pattern) => {
		const output: string[] = [];
		const logger = new Logger((msg) => output.push(msg));
		logger[method]("hello");
		expect(output[0]).toMatch(pattern);
	});

	test("err() writes to stderr", () => {
		const errors: string[] = [];
		const logger = new Logger(undefined, (msg) => errors.push(msg));
		logger.err("bad");
		expect(errors[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] ERROR: bad$/);
	});
});
