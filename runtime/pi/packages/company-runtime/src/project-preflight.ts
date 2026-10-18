import { probeWorkspaceEvidence, WorkspaceEvidenceError } from "./workspace.ts";

type WorkspaceDiagnosticCode =
	| "WORKSPACE_EVIDENCE_CAPACITY"
	| "WORKSPACE_EVIDENCE_UNSUPPORTED"
	| "WORKSPACE_EVIDENCE_UNAVAILABLE";

export type ProjectWorkspaceAssessment =
	| {
			readonly schemaVersion: 1;
			readonly kind: "supported";
			readonly profile: {
				readonly mode: "default" | "bounded-monorepo";
				readonly candidate: boolean;
			};
			readonly fileCount: number;
			readonly totalBytes: number;
	  }
	| {
			readonly schemaVersion: 1;
			readonly kind: "unsupported";
			readonly diagnostic: {
				readonly code: WorkspaceDiagnosticCode;
				readonly action: string;
			};
	  };

function diagnostic(error: unknown): ProjectWorkspaceAssessment {
	const kind = error instanceof WorkspaceEvidenceError ? error.kind : "unavailable";
	if (kind === "capacity")
		return {
			schemaVersion: 1,
			kind: "unsupported",
			diagnostic: {
				code: "WORKSPACE_EVIDENCE_CAPACITY",
				action:
					"작업 공간 증거 한도를 넘었어요. 편집 가능 경로를 더 좁혀 검토해 주세요. 편집 경로의 2 MiB 초과 파일은 프로필을 바꿔도 지원되지 않아요.",
			},
		};
	if (kind === "unsupported")
		return {
			schemaVersion: 1,
			kind: "unsupported",
			diagnostic: {
				code: "WORKSPACE_EVIDENCE_UNSUPPORTED",
				action: "지원하지 않는 경로·파일 형식·Git 항목이 있어요. 해당 항목을 검토해 주세요.",
			},
		};
	return {
		schemaVersion: 1,
		kind: "unsupported",
		diagnostic: {
			code: "WORKSPACE_EVIDENCE_UNAVAILABLE",
			action: "Git과 작업 공간을 읽을 수 있는지 확인한 뒤 다시 진단해 주세요.",
		},
	};
}

/** Read-only bounded evidence preflight. A larger profile is returned only as a reviewable candidate. */
export async function assessProjectWorkspace(
	cwd: string,
	allowedPaths: readonly string[],
): Promise<ProjectWorkspaceAssessment> {
	try {
		const capture = await probeWorkspaceEvidence(cwd, { allowedPaths });
		return {
			schemaVersion: 1,
			kind: "supported",
			profile: { mode: "default", candidate: false },
			...capture,
		};
	} catch (error) {
		if (!(error instanceof WorkspaceEvidenceError) || error.kind !== "capacity") return diagnostic(error);
	}

	try {
		const capture = await probeWorkspaceEvidence(cwd, {
			allowedPaths,
			evidenceMode: "bounded-monorepo",
		});
		return {
			schemaVersion: 1,
			kind: "supported",
			profile: { mode: "bounded-monorepo", candidate: true },
			...capture,
		};
	} catch (error) {
		return diagnostic(error);
	}
}
