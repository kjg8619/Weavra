import { describe, expect, it } from "vitest";
import {
	BrowserObservationError,
	observeLocalBrowser,
	parseBrowserObservationArguments,
} from "../src/browser-observation.ts";

const argumentsFor = (url: string) => [
	"observe",
	"--local-test-app",
	"--executable",
	process.execPath,
	"--url",
	url,
	"--json",
];

describe("Host-only browser observation admission", () => {
	it("rejects remote origins, DNS discovery, non-HTTP documents, and privileged endpoints", () => {
		for (const url of [
			"https://127.0.0.1:3880/",
			"http://example.com:3880/",
			"http://localhost:3880/",
			"file:///etc/passwd",
			"http://127.0.0.1/",
		])
			expect(() => parseBrowserObservationArguments(argumentsFor(url))).toThrow(BrowserObservationError);
	});

	it("rejects Unicode URLs that exceed the capture bound after canonical encoding", () => {
		expect(() => parseBrowserObservationArguments(argumentsFor(`http://127.0.0.1:3880/${"한".repeat(300)}`))).toThrow(
			BrowserObservationError,
		);
	});

	it("rejects credentials and unreviewed query or fragment state", () => {
		for (const url of [
			"http://user:secret@127.0.0.1:3880/",
			"http://127.0.0.1:3880/?token=secret",
			"http://127.0.0.1:3880/#session",
		])
			expect(() => parseBrowserObservationArguments(argumentsFor(url))).toThrow(BrowserObservationError);
	});

	it("does not accept action, CDP, profile reuse, or completion commands", () => {
		const accepted = argumentsFor("http://127.0.0.1:3880/fixture");
		for (const operation of ["act", "DONE", "PASS", "COMPLETE"])
			expect(() => parseBrowserObservationArguments([operation, ...accepted.slice(1)])).toThrow(
				BrowserObservationError,
			);
		for (const option of ["--cdp-url", "--profile", "--evaluate", "--click", "--register-check"])
			expect(() => parseBrowserObservationArguments([...accepted, option, "untrusted"])).toThrow(
				BrowserObservationError,
			);
	});

	it("requires explicit Host acknowledgement and an absolute browser instead of ambient defaults", () => {
		const accepted = argumentsFor("http://127.0.0.1:3880/fixture");
		expect(() => parseBrowserObservationArguments(accepted.filter((value) => value !== "--local-test-app"))).toThrow(
			BrowserObservationError,
		);
		expect(() =>
			parseBrowserObservationArguments(accepted.map((value) => (value === process.execPath ? "chrome" : value))),
		).toThrow(BrowserObservationError);
		expect(() => parseBrowserObservationArguments([...accepted, "--url", "http://127.0.0.1:3881/"])).toThrow(
			BrowserObservationError,
		);
	});

	it("applies the same origin restriction to direct Host API calls", async () => {
		await expect(
			observeLocalBrowser({ url: "http://example.com:3880/", executable: process.execPath, localTestApp: true }),
		).rejects.toThrow(BrowserObservationError);
	});

	it("honors an already cancelled request before resolving or starting a browser", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			observeLocalBrowser({
				url: "http://127.0.0.1:3880/fixture",
				executable: "/nonexistent-weavra-browser",
				localTestApp: true,
				signal: controller.signal,
			}),
		).rejects.toBe(controller.signal.reason);
	});
});
