import type { Complexity } from "../config/types.js";

export function modelForComplexity(complexity: Complexity): string {
	return complexity === "low" ? "claude-sonnet-4-6" : "claude-opus-4-6";
}
