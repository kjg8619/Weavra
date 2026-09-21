import { Check } from "typebox/value";
import {
	type BrowserAssertion,
	type BrowserTargetObservation,
	BrowserVerificationEvidenceSchema,
	browserDigest,
	browserEvidenceDigestOf,
	browserRegistrationDigestOf,
	type RegisteredBrowserCheck,
	validateRegisteredBrowserCheck,
} from "./browser-types.ts";
import type { CheckResult } from "./contracts.ts";

/** The independent verifier calls this on a newly captured target, never on a stored candidate. */
export function evaluateBrowserAssertion(assertion: BrowserAssertion, observation: BrowserTargetObservation): boolean {
	switch (assertion.type) {
		case "element_exists":
			return observation.exists;
		case "element_not_exists":
			return !observation.exists;
		case "text_equals":
		case "attribute_equals":
			return observation.exists && observation.value === assertion.expected;
		case "text_contains":
			return (
				observation.exists &&
				observation.value !== null &&
				assertion.expected.length > 0 &&
				observation.value.includes(assertion.expected)
			);
	}
}

/** Structural/binding checks are also usable by historical projections; pass a clock only for live admission. */
export function validBrowserCheckEvidence(
	check: CheckResult,
	registered?: RegisteredBrowserCheck,
	evaluatedAt?: number,
): boolean {
	const evidence = check.browser;
	if (
		check.kind !== "browser" ||
		!evidence ||
		!Check(BrowserVerificationEvidenceSchema, evidence) ||
		!check.step ||
		!["self-check", "test"].includes(check.step.stepId) ||
		check.step.attempt !== check.revision + 1 ||
		check.exitCode !== null ||
		check.failureKind !== undefined ||
		check.sandbox !== undefined ||
		check.startedAt === undefined ||
		check.finishedAt === undefined ||
		check.startedAt > evidence.capturedAt ||
		check.finishedAt < evidence.capturedAt ||
		check.evidenceRefs.length === 0 ||
		check.status !== evidence.result
	)
		return false;
	const definition = {
		version: 1 as const,
		checkId: check.id,
		projectId: evidence.projectId,
		origin: evidence.origin,
		documentIdentity: evidence.documentIdentity,
		target: evidence.target,
		assertion: evidence.assertion,
		freshness: evidence.freshness,
	};
	try {
		validateRegisteredBrowserCheck({ ...definition, registrationDigest: evidence.registrationDigest });
		if (
			registered &&
			(registered.checkId !== check.id ||
				browserRegistrationDigestOf(registered) !== evidence.registrationDigest ||
				browserDigest(registered) !==
					browserDigest({ ...definition, registrationDigest: evidence.registrationDigest }))
		)
			return false;
	} catch {
		return false;
	}
	if (
		evidence.browserEvidenceDigest !==
		browserEvidenceDigestOf(evidence, {
			checkId: check.id,
			runId: check.runId,
			revision: check.revision,
			step: check.step,
			diffDigest: check.diffDigest,
		})
	)
		return false;
	if (check.status === "PASS") {
		if (
			check.trust?.mode !== "strict" ||
			check.trust.status !== "VERIFIED" ||
			check.trust.executableDigest !== evidence.executableIdentityDigest ||
			check.finishedAt - evidence.capturedAt > evidence.freshness.maxAgeMs
		)
			return false;
		if (
			evaluatedAt !== undefined &&
			(evaluatedAt < evidence.capturedAt || evaluatedAt - evidence.capturedAt > evidence.freshness.maxAgeMs)
		)
			return false;
	}
	return true;
}

/** Preserve capture provenance when a later integrity fence revokes a once-passing check. */
export function invalidateBrowserCheck(check: CheckResult): void {
	if (!check.browser || !check.step) return;
	check.browser.result = "FAIL";
	check.browser.browserEvidenceDigest = browserEvidenceDigestOf(check.browser, {
		checkId: check.id,
		runId: check.runId,
		revision: check.revision,
		step: check.step,
		diffDigest: check.diffDigest,
	});
}
