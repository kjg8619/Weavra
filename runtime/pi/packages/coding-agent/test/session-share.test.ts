import type * as ChildProcess from "node:child_process";
import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof ChildProcess>()),
	...childProcessMocks,
}));

import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { shareSession } from "../src/modes/interactive/session-share.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("hosted sharing is unavailable", () => {
	it.each(["/share", "/share https://example.invalid/upload"])(
		"rejects %s without touching a session or uploading",
		async (command) => {
			vi.stubEnv("PI_TELEMETRY", "1");
			vi.stubEnv("PI_SHARE_VIEWER_URL", "https://example.invalid/viewer/");
			vi.stubEnv("PI_RADIUS_GATEWAY", "https://example.invalid/radius/");
			const fetchMock = vi.fn(() => {
				throw new Error("Upload forbidden");
			});
			vi.stubGlobal("fetch", fetchMock);
			const errors: string[] = [];
			const showError = (message: string) => errors.push(message);
			const mode = Object.assign(Object.create(InteractiveMode.prototype), {
				defaultEditor: {} as { onSubmit?: (text: string) => Promise<void> },
				editor: { setText: vi.fn() },
				showError,
			}) as {
				setupEditorSubmitHandler(): void;
				defaultEditor: { onSubmit?: (text: string) => Promise<void> };
				editor: { setText: Mock };
			};
			Object.defineProperty(mode, "session", {
				get() {
					throw new Error("Session/auth/export access forbidden");
				},
			});
			mode.setupEditorSubmitHandler();
			await mode.defaultEditor.onSubmit!(command);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain("/export");
			expect(mode.editor.setText).toHaveBeenCalledWith("");
			await shareSession({ showError });
			expect(errors).toHaveLength(2);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(childProcessMocks.spawn).not.toHaveBeenCalled();
			expect(childProcessMocks.spawnSync).not.toHaveBeenCalled();
		},
	);
});
