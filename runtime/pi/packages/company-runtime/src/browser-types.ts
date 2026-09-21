import { createHash } from "node:crypto";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const strict = { additionalProperties: false } as const;
const digest = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const timestamp = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const identifier = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" });
const url = Type.String({ minLength: 1, maxLength: 2048 });
export const BROWSER_VALUE_LIMIT = 1024;
export const BROWSER_ATTRIBUTES = [
	"role",
	"title",
	"aria-label",
	"aria-disabled",
	"aria-checked",
	"aria-expanded",
	"aria-selected",
] as const;
export const BrowserTargetSchema = Type.Object(
	{
		selector: Type.String({ pattern: "^#[A-Za-z][A-Za-z0-9_-]{0,63}$", maxLength: 65 }),
		attribute: Type.Optional(Type.Enum(BROWSER_ATTRIBUTES)),
	},
	strict,
);
export type BrowserTarget = Static<typeof BrowserTargetSchema>;
export const BrowserTargetObservationSchema = Type.Object(
	{
		target: BrowserTargetSchema,
		exists: Type.Boolean(),
		value: Type.Union([Type.String({ maxLength: BROWSER_VALUE_LIMIT }), Type.Null()]),
	},
	strict,
);
export type BrowserTargetObservation = Static<typeof BrowserTargetObservationSchema>;
export const BrowserObservationSchema = Type.Object(
	{
		url,
		title: Type.String({ maxLength: 256 }),
		text: Type.String({ maxLength: 6000 }),
		markerDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		elements: Type.Array(
			Type.Object(
				{
					id: Type.String({ maxLength: 16 }),
					role: Type.String({ maxLength: 32 }),
					label: Type.String({ maxLength: 256 }),
					kind: Type.Enum(["click", "fill", "select"]),
				},
				strict,
			),
			{ maxItems: 64 },
		),
		omittedElements: Type.Integer({ minimum: 0 }),
		target: Type.Optional(BrowserTargetObservationSchema),
	},
	strict,
);
export type BrowserObservation = Static<typeof BrowserObservationSchema>;
export const BrowserCaptureSchema = Type.Object(
	{
		first: BrowserObservationSchema,
		second: BrowserObservationSchema,
		startedAt: timestamp,
		finishedAt: timestamp,
		browserVersion: Type.String({ minLength: 1, maxLength: 128 }),
		/** SHA-256 of Chromium's bounded decoded response body, not a complete visual-state fingerprint. */
		documentDigest: digest,
	},
	strict,
);
export const BrowserObservationCandidateSchema = Type.Object(
	{
		schemaVersion: Type.Literal(2),
		kind: Type.Literal("BROWSER_OBSERVATION_CANDIDATE"),
		candidateId: Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }),
		projectId: digest,
		authority: Type.Literal("CANDIDATE_ONLY"),
		scope: Type.Literal("LOCAL_STATIC_DOCUMENT"),
		origin: url,
		documentIdentity: url,
		capturedAt: timestamp,
		pageRevision: digest,
		observationType: Type.Enum(["document", "target"]),
		source: Type.Object(
			{
				implementationRevision: digest,
				readerRevision: Type.String({ pattern: "^[a-f0-9]{40}$" }),
				readerDigest: digest,
				executableIdentityDigest: digest,
				browserVersion: Type.String({ minLength: 1, maxLength: 128 }),
			},
			strict,
		),
		freshness: Type.Object(
			{ mode: Type.Literal("CAPTURE_ONLY"), startedAt: timestamp, finishedAt: timestamp },
			strict,
		),
		observationDigest: digest,
		observation: BrowserObservationSchema,
		candidateDigest: digest,
		cleanup: Type.Literal("CONFIRMED"),
	},
	strict,
);
export type BrowserObservationCandidate = Static<typeof BrowserObservationCandidateSchema>;
export const BrowserAssertionSchema = Type.Union([
	Type.Object(
		{ type: Type.Enum(["text_equals", "text_contains"]), expected: Type.String({ maxLength: BROWSER_VALUE_LIMIT }) },
		strict,
	),
	Type.Object({ type: Type.Enum(["element_exists", "element_not_exists"]) }, strict),
	Type.Object(
		{ type: Type.Literal("attribute_equals"), expected: Type.String({ maxLength: BROWSER_VALUE_LIMIT }) },
		strict,
	),
]);
export type BrowserAssertion = Static<typeof BrowserAssertionSchema>;
export const BrowserFreshnessPolicySchema = Type.Object(
	{
		mode: Type.Literal("NEW_ISOLATED_CAPTURE"),
		maxAgeMs: Type.Integer({ minimum: 1, maximum: 15000 }),
	},
	strict,
);
export type BrowserFreshnessPolicy = Static<typeof BrowserFreshnessPolicySchema>;
export const RegisteredBrowserCheckSchema = Type.Object(
	{
		version: Type.Literal(1),
		checkId: identifier,
		projectId: digest,
		origin: url,
		documentIdentity: url,
		target: BrowserTargetSchema,
		assertion: BrowserAssertionSchema,
		freshness: BrowserFreshnessPolicySchema,
		registrationDigest: digest,
	},
	strict,
);
export type RegisteredBrowserCheck = Static<typeof RegisteredBrowserCheckSchema>;
/** Data supplied to the Host preview path. No executable, result, or registration identity is accepted. */
export const BrowserRegistrationRequestSchema = Type.Object(
	{
		candidateId: BrowserObservationCandidateSchema.properties.candidateId,
		expectedCandidateDigest: digest,
		checkId: identifier,
		origin: url,
		documentIdentity: url,
		target: BrowserTargetSchema,
		assertion: BrowserAssertionSchema,
		freshness: BrowserFreshnessPolicySchema,
	},
	strict,
);
export type BrowserRegistrationRequest = Static<typeof BrowserRegistrationRequestSchema>;
export const BrowserVerificationEvidenceSchema = Type.Object(
	{
		version: Type.Literal(1),
		registrationDigest: digest,
		projectId: digest,
		origin: url,
		documentIdentity: url,
		documentDigest: digest,
		observationType: Type.Literal("target"),
		target: BrowserTargetSchema,
		assertion: BrowserAssertionSchema,
		freshness: BrowserFreshnessPolicySchema,
		captureId: BrowserObservationCandidateSchema.properties.candidateId,
		capturedAt: timestamp,
		implementationRevision: digest,
		executableIdentityDigest: digest,
		browserVersion: Type.String({ minLength: 1, maxLength: 128 }),
		observationDigest: digest,
		isolation: Type.Literal("PRIVATE_HOME_PROFILE_CDP_PIPE"),
		cleanup: Type.Literal("CONFIRMED"),
		result: Type.Enum(["PASS", "FAIL"]),
		browserEvidenceDigest: digest,
	},
	strict,
);
export type BrowserVerificationEvidence = Static<typeof BrowserVerificationEvidenceSchema>;

/** Stable key ordering, following the Host preview fingerprint convention; not a signature or authority. */
export function browserDigest(value: unknown): string {
	return `sha256:${createHash("sha256")
		.update(
			JSON.stringify(value, (_key, item: unknown) => {
				if (!item || typeof item !== "object" || Array.isArray(item)) return item;
				return Object.fromEntries(
					Object.entries(item).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
				);
			}),
		)
		.digest("hex")}`;
}
export function browserProjectId(canonicalRoot: string): string {
	return browserDigest({ domain: "weavra-browser-project-v1", canonicalRoot });
}
export function candidateDigestOf(candidate: Omit<BrowserObservationCandidate, "candidateDigest">): string {
	const { candidateDigest: _ignored, ...fields } = candidate as BrowserObservationCandidate;
	return browserDigest({ domain: "weavra-browser-candidate-v2", candidate: fields });
}
export function browserRegistrationDigestOf(check: Omit<RegisteredBrowserCheck, "registrationDigest">): string {
	const { registrationDigest: _ignored, ...fields } = check as RegisteredBrowserCheck;
	return browserDigest({ domain: "weavra-browser-check-v1", check: fields });
}
export function browserEvidenceDigestOf(
	evidence: Omit<BrowserVerificationEvidence, "browserEvidenceDigest">,
	binding: {
		checkId: string;
		runId: string;
		revision: number;
		step: { stepId: string; attempt: number };
		diffDigest: string;
	},
): string {
	const { browserEvidenceDigest: _ignored, ...fields } = evidence as BrowserVerificationEvidence;
	return browserDigest({ domain: "weavra-browser-evidence-v1", binding, evidence: fields });
}
export function canonicalBrowserDocument(input: string): string {
	const parsed = new URL(input);
	if (
		input.length > 2048 ||
		parsed.href.length > 2048 ||
		parsed.protocol !== "http:" ||
		parsed.hostname !== "127.0.0.1" ||
		!parsed.port ||
		Number(parsed.port) < 1024 ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	)
		throw new Error("Unsupported browser document");
	return parsed.href;
}
export function validateBrowserCandidate(value: unknown): BrowserObservationCandidate {
	if (!Check(BrowserObservationCandidateSchema, value)) throw new Error("Invalid browser candidate");
	const document = canonicalBrowserDocument(value.documentIdentity);
	if (
		document !== value.documentIdentity ||
		new URL(document).origin !== value.origin ||
		value.observation.url !== document ||
		value.candidateDigest !== candidateDigestOf(value) ||
		value.observationDigest !== browserDigest(value.observation) ||
		value.capturedAt !== value.freshness.finishedAt ||
		value.freshness.startedAt > value.capturedAt ||
		(value.observationType === "target") !== (value.observation.target !== undefined) ||
		(value.observation.target?.exists === false && value.observation.target.value !== null)
	)
		throw new Error("Browser candidate integrity mismatch");
	return value;
}
export function validateRegisteredBrowserCheck(value: unknown): RegisteredBrowserCheck {
	if (!Check(RegisteredBrowserCheckSchema, value)) throw new Error("Invalid registered browser check");
	const document = canonicalBrowserDocument(value.documentIdentity);
	if (
		document !== value.documentIdentity ||
		new URL(document).origin !== value.origin ||
		value.registrationDigest !== browserRegistrationDigestOf(value) ||
		(value.assertion.type === "attribute_equals") !== (value.target.attribute !== undefined) ||
		(value.assertion.type === "text_contains" && value.assertion.expected.length === 0)
	)
		throw new Error("Browser check registration mismatch");
	return value;
}
