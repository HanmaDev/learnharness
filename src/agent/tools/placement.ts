import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult, questionResult } from "../tool-execute.ts";
import { placementResultSchema, placementTestProblems, placementTestSchema } from "../../core/placement.ts";

/**
 * Placement (fork, 2026-11-08): the full written test and its result screen —
 * question tools (the turn pauses until the learner answers; the answer comes
 * back as this call's result). See core/placement.ts.
 */
export const placementTestTool: AgentTool<typeof placementTestSchema> = {
	name: "placement_test",
	label: "placement_test",
	description:
		"Give the learner a FULL written placement test: every topic of the syllabus, 1-4 questions each (quiz / short / math), " +
		"shown as one page they work through at their own pace. Pauses until they submit; their answers come back as this call's " +
		"result (quiz and math already graded, short answers for you to grade). Then call placement_result.",
	parameters: placementTestSchema,
	executionMode: "sequential",
	execute: async (_id, input) => {
		const problems = placementTestProblems(input);
		if (problems.length > 0) return invalidInputResult("placement_test", problems);
		return questionResult();
	},
};

export const placementResultTool: AgentTool<typeof placementResultSchema> = {
	name: "placement_result",
	label: "placement_result",
	description:
		"Show the learner the placement test result: per topic a score (your grading included) and your proposal — znam (skip), " +
		"ponoviti (short review) or ucim (teach fully). They can change any proposal and confirm; the confirmed decisions come back " +
		"as this call's result. Build the plan from those decisions.",
	parameters: placementResultSchema,
	executionMode: "sequential",
	execute: async () => questionResult(),
};
