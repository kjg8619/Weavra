import { describe, expect, it } from "vitest";
import { projectTaskFailureSummary } from "../src/host-control.ts";

describe("task failure summary projection", () => {
	it("maps canonical check and run failures to bounded values only", () => {
		expect(
			projectTaskFailureSummary({
				status: "BLOCKED",
				lastError: "credential=do-not-project",
				verification: [{ status: "FAIL", reason: "raw argv and stack do-not-project" }],
			}),
		).toEqual({ code: "CHECK_FAILED", nextAction: "REVIEW_CHECK_FAILURE" });
		expect(
			projectTaskFailureSummary({
				status: "FAILED",
				lastError: "credential=do-not-project",
				verification: [],
			}),
		).toEqual({ code: "RUN_FAILED", nextAction: "REVIEW_RUN_FAILURE" });
	});

	it("omits success and failures without canonical detail", () => {
		expect(
			projectTaskFailureSummary({
				status: "COMPLETED",
				lastError: null,
				verification: [{ status: "FAIL", reason: "inconsistent legacy data" }],
			}),
		).toBeUndefined();
		expect(
			projectTaskFailureSummary({
				status: "FAILED",
				lastError: null,
				verification: [
					{ status: "FAIL", reason: "stale check failure" },
					{ status: "PASS", reason: "latest check passed" },
				],
			}),
		).toBeUndefined();
	});
});
