import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	AnalysisContextSchema,
	analysisContextDigest,
	TaskAdmissionSchema,
	TaskReceiptSchema,
	TaskRunMetadataSchema,
	validateContract,
} from "../src/contracts.ts";
import {
	HOST_CONTROL_COMMANDS,
	HostCheckoutIdentityDataSchema,
	HostCheckoutIdentityRequestSchema,
	HostControlRequestSchema,
	HostTaskPrepareRequestSchema,
	HostTaskReceiptRequestSchema,
	HostTaskRecoveryDataSchema,
} from "../src/host-control-protocol.ts";

const digest = `sha256:${"a".repeat(64)}`;
const executionId = "22222222-2222-4222-8222-222222222222";
const packet = {
	version: 1,
	packetVersion: 1,
	authority: "ADVISORY_ONLY",
	reviewedAt: 100,
	symptom: "The requested value is missing.",
	observations: [
		{
			text: "The source returns an empty value.",
			provenance: "MODEL",
			reference: { kind: "source", path: "src/value.ts" },
		},
	],
	candidateCause: { kind: "HYPOTHESIS", text: "An early return may discard the value." },
	uncertainties: [],
	sourceReferences: [{ path: "src/value.ts", digest }],
	constraints: [],
};
const metadata = {
	binding: {
		taskId: "11111111-1111-4111-8111-111111111111",
		environmentId: "environment",
		projectId: "project",
		threadId: "thread",
		checkout: {
			canonicalCwd: "/project",
			repositoryRoot: "/project",
			headCommit: "a".repeat(40),
			workspaceDigest: digest,
		},
		executionId,
		packetVersion: 1,
		advisoryDigest: digest,
		symptomVerification: { criterionId: "AC-001", checkId: "symptom", registrationDigest: digest },
	},
	previewDigest: digest,
	configDigest: digest,
	confirmedProjectRevision: 0,
	admittedProjectRevision: 1,
};

describe("optional task binding schemas", () => {
	it("round-trips explicit recovery without extending the legacy command tuple", () => {
		const request = {
			protocolVersion: 1,
			id: "owner:1",
			ownerId: "owner",
			expectedProjectRevision: 1,
			type: "workflow.recover",
			metadata,
		};
		expect(Check(HostControlRequestSchema, JSON.parse(JSON.stringify(request)))).toBe(true);
		expect(Check(HostControlRequestSchema, { ...request, executionId })).toBe(false);
		expect(Check(HostControlRequestSchema, { ...request, metadata: { ...metadata, extra: true } })).toBe(false);
		expect(HOST_CONTROL_COMMANDS).not.toContain("workflow.recover");
		for (const cleanup of ["NOT_STARTED", "UNCONFIRMED", "CONFIRMED"]) {
			const receipt = {
				status: "FOUND",
				executionId,
				run: null,
				admission: {
					metadata,
					outcome: { status: "INTERRUPTED_BEFORE_START", reasonCode: "OWNER_LOST" },
					acceptedAt: 1,
					updatedAt: 2,
					cleanup,
				},
			};
			expect(Check(TaskReceiptSchema, receipt)).toBe(true);
			expect(
				Check(HostTaskRecoveryDataSchema, {
					kind: "task-recovery",
					receipt,
					disposition: "RECOVERED",
					cleanup: cleanup === "UNCONFIRMED" ? "UNCONFIRMED" : "CONFIRMED",
					reason: cleanup === "UNCONFIRMED" ? "CLEANUP_UNCONFIRMED" : null,
				}),
			).toBe(true);
		}
		expect(
			Check(HostTaskRecoveryDataSchema, {
				kind: "task-recovery",
				receipt: { status: "UNKNOWN", executionId },
				disposition: "NOT_RECOVERED",
				cleanup: "UNCONFIRMED",
				reason: "arbitrary text",
			}),
		).toBe(false);
	});
	it("accepts bounded advisory data and rejects authority and reference injection", () => {
		expect(Check(AnalysisContextSchema, packet)).toBe(true);
		for (const patch of [
			{ authority: "VERIFIED" },
			{ tools: ["write"] },
			{ symptom: "x".repeat(1001) },
			{ symptom: "\ud83d\ude00".repeat(501) },
			{ sourceReferences: [{ path: "../secret", digest }] },
			{ sourceReferences: [{ path: "src/value.ts", digest, lines: { start: 2, end: 1 } }] },
			{ observations: [{ ...packet.observations[0], provenance: "REGISTERED_VERIFIER" }] },
			{ observations: Array.from({ length: 8 }, () => ({ ...packet.observations[0], text: "한".repeat(500) })) },
		]) {
			expect(Check(AnalysisContextSchema, { ...packet, ...patch })).toBe(false);
		}
	});

	it("hashes the same reviewed packet independently of object key order", () => {
		const context = validateContract(AnalysisContextSchema, packet);
		const reordered = validateContract(AnalysisContextSchema, Object.fromEntries(Object.entries(packet).reverse()));
		expect(analysisContextDigest(context)).toBe(analysisContextDigest(reordered));
		expect(analysisContextDigest({ ...context, packetVersion: 2 })).not.toBe(analysisContextDigest(context));
	});

	it("counts padded message identifiers without normalizing the packet", () => {
		const messagePacket = (messageId: string) => ({
			...packet,
			observations: [
				{
					text: "A visible message",
					provenance: "USER",
					reference: { kind: "message", threadId: " thread ", messageId },
				},
			],
		});
		const bounded = messagePacket(" message ");
		expect(validateContract(AnalysisContextSchema, bounded)).toEqual(bounded);
		const oversized = messagePacket(`${" ".repeat(9000)}m`);
		expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(8192);
		expect(Check(AnalysisContextSchema, oversized)).toBe(false);
	});

	it("accepts bounded task requests on the capability-gated live protocol", () => {
		const request = {
			protocolVersion: 1,
			id: "owner:1",
			ownerId: "owner",
			expectedProjectRevision: 0,
			type: "workflow.prepare",
			goal: "Fix the issue",
			acceptanceStatements: ["The symptom is absent"],
			task: {
				taskId: metadata.binding.taskId,
				environmentId: "environment",
				projectId: "project",
				threadId: "thread",
				checkout: metadata.binding.checkout,
				analysisContext: packet,
				symptomVerification: { criterionIndex: 1, checkId: "symptom" },
			},
		};
		expect(Check(HostTaskPrepareRequestSchema, request)).toBe(true);
		expect(Check(HostControlRequestSchema, request)).toBe(true);
		expect(
			Check(HostTaskPrepareRequestSchema, {
				...request,
				goal: "한".repeat(2048),
				acceptanceStatements: Array.from({ length: 16 }, () => "한".repeat(500)),
				task: { ...request.task, analysisContext: { ...packet, symptom: "한".repeat(1000) } },
			}),
		).toBe(false);
		const receipt = { protocolVersion: 1, id: "read:1", type: "workflow.receipt", executionId };
		expect(Check(HostTaskReceiptRequestSchema, receipt)).toBe(true);
		expect(Check(HostControlRequestSchema, receipt)).toBe(true);
		expect(HOST_CONTROL_COMMANDS).not.toContain("workflow.receipt");
	});

	it("keeps checkout capture read-only and outside the legacy command tuple", () => {
		const request = { protocolVersion: 1, id: "read:2", type: "workflow.checkout" };
		expect(Check(HostCheckoutIdentityRequestSchema, request)).toBe(true);
		expect(Check(HostControlRequestSchema, request)).toBe(true);
		expect(Check(HostCheckoutIdentityRequestSchema, { ...request, cwd: "/other" })).toBe(false);
		expect(
			Check(HostCheckoutIdentityDataSchema, {
				kind: "checkout-identity",
				checkout: metadata.binding.checkout,
			}),
		).toBe(true);
		expect(HOST_CONTROL_COMMANDS).not.toContain("workflow.checkout");
	});

	it("binds admission to distinct confirmed and admitted project revisions", () => {
		expect(Check(TaskRunMetadataSchema, metadata)).toBe(true);
		expect(Check(TaskRunMetadataSchema, { ...metadata, admittedProjectRevision: 0 })).toBe(false);
		for (const outcome of [
			{ status: "ACCEPTED", runId: "invented" },
			{ status: "STARTED" },
			{ status: "START_FAILED", runId: "invented", reasonCode: "INITIALIZATION_FAILED" },
			{ status: "INTERRUPTED_BEFORE_START" },
		]) {
			expect(Check(TaskAdmissionSchema, { metadata, outcome, acceptedAt: 1, updatedAt: 1 })).toBe(false);
		}
	});

	it("rejects receipt cross-execution and cross-run identities", () => {
		const receipt = {
			status: "FOUND",
			executionId,
			admission: { metadata, outcome: { status: "STARTED", runId: "run" }, acceptedAt: 1, updatedAt: 1 },
			run: { runId: "run", status: "CANCELLED", revision: 2 },
		};
		expect(Check(TaskReceiptSchema, receipt)).toBe(true);
		expect(Check(TaskReceiptSchema, { ...receipt, executionId: "33333333-3333-4333-8333-333333333333" })).toBe(false);
		expect(Check(TaskReceiptSchema, { ...receipt, run: { ...receipt.run, runId: "other" } })).toBe(false);
		expect(Check(TaskReceiptSchema, { status: "UNKNOWN", executionId })).toBe(true);
		expect(Check(TaskReceiptSchema, { status: "UNKNOWN", executionId, statusOverride: "COMPLETED" })).toBe(false);
	});
});
