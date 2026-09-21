import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { Check } from "typebox/value";
import { parseBrowserObservationArguments } from "./browser-observation.ts";
import { JEV_SNAPSHOT_SOURCE } from "./browser-snapshot.ts";
import { BrowserObservationSchema, BrowserTargetObservationSchema, BrowserTargetSchema } from "./browser-types.ts";
import { verificationEnvironment } from "./process-runner.ts";

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Fixed expressions only. Target data is passed as a CDP value, never interpolated into JavaScript.
// No raw field values, guards, node handles, cookies, storage, or screenshots leave this helper.
const observationExpression = `(async () => {
	if (document.readyState !== "complete" ||
		document.querySelector("script,iframe,frame,canvas,object,embed") ||
		Array.from(document.querySelectorAll("*")).some(element => element.shadowRoot))
		throw new Error("Unsupported static document");
	const observed = ${JEV_SNAPSHOT_SOURCE};
	if (!observed) throw new Error("No document");
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(observed.marker)));
	const controls = observed.actions.filter(action => ["click", "fill", "select"].includes(action.kind));
	return {
		url: observed.url,
		title: observed.title.slice(0, 256),
		text: observed.text,
		markerDigest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
		elements: controls.slice(0, 64).map(action => ({
			id: action.id, role: action.role, label: action.label.slice(0, 256), kind: action.kind
		})),
		omittedElements: observed.omitted_actions + Math.max(0, controls.length - 64)
	};
})()`;

const targetExpression = `function(target) {
	const matches = Array.from(document.querySelectorAll("[id]")).filter(element => element.id === target.selector.slice(1));
	if (matches.length > 1) throw new Error("Ambiguous target");
	if (!matches.length) return {target, exists:false, value:null};
	const element = matches[0];
	const forbidden = 'input,textarea,select,option,script,style,noscript,template,[contenteditable],[hidden],[aria-hidden="true"],[inert]';
	if (element.closest(forbidden) || element.querySelector(forbidden) ||
		!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))
		throw new Error("Unsupported target");
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth)
		throw new Error("Target outside observation viewport");
	const value = target.attribute ? element.getAttribute(target.attribute) : element.innerText.trim();
	if (value !== null && value.length > 1024) throw new Error("Target value exceeds bound");
	return {target, exists:true, value};
}`;

async function capture(): Promise<void> {
	if (process.argv.length !== 5) throw new Error("Invalid invocation");
	const targetInput: unknown = JSON.parse(process.argv[4]);
	if (targetInput !== null && !Check(BrowserTargetSchema, targetInput)) throw new Error("Invalid target");
	const request = parseBrowserObservationArguments([
		"observe",
		"--executable",
		process.argv[2],
		"--url",
		process.argv[3],
		"--local-test-app",
		"--json",
		...(targetInput
			? [
					"--selector",
					targetInput.selector,
					...(targetInput.attribute ? ["--attribute", targetInput.attribute] : []),
				]
			: []),
	]);
	const directory = process.cwd();
	const info = await lstat(directory);
	if (
		!basename(directory).startsWith("weavra-browser-") ||
		!info.isDirectory() ||
		info.isSymbolicLink() ||
		(info.mode & 0o077) !== 0
	)
		throw new Error("Invalid private directory");
	const profile = join(directory, "profile");
	// Exclusive: never reuse or attach to an existing profile, daemon, tab, or debugging port.
	await mkdir(profile, { mode: 0o700 });
	const child = spawn(
		request.executable,
		[
			"--headless=new",
			"--disable-gpu",
			"--remote-debugging-pipe",
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-background-networking",
			"--disable-component-update",
			"--disable-sync",
			"--disable-extensions",
			"--dns-prefetch-disable",
			"--disable-features=Prerender2,SpeculationRulesPrefetch,PreconnectToSearch",
			"--password-store=basic",
			"--use-mock-keychain",
		],
		{
			cwd: directory,
			env: { ...verificationEnvironment(), HOME: join(directory, "home"), TMPDIR: directory },
			// The parent runProcess owns this entire process group, including Chromium descendants.
			detached: false,
			stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
		},
	);
	let closed = false;
	const exited = new Promise<void>((resolve) =>
		child.once("close", () => {
			closed = true;
			resolve();
		}),
	);
	child.stderr?.resume();
	const input = child.stdio[3];
	const output = child.stdio[4];
	if (!(input instanceof Writable) || !(output instanceof Readable)) {
		child.kill("SIGTERM");
		await exited;
		throw new Error("No browser pipe");
	}
	const pending = new Map<
		number,
		{ resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
	>();
	let sequence = 0;
	let failure: Error | undefined;
	let closing = false;
	let session: string | undefined;
	let rootFrame: string | undefined;
	let documentRequests = 0;
	let deniedRequests = 0;
	let documentResponseId: string | undefined;
	let documentBytes = 0;
	let documentEncodedBytes = 0;
	let wakeLoad: (() => void) | undefined;
	const loaded = new Set<string>();
	const fail = () => {
		if (failure || closing) return;
		failure = new Error("Browser protocol unavailable");
		for (const item of pending.values()) item.reject(failure);
		pending.clear();
		wakeLoad?.();
	};
	const call = (
		method: string,
		params: Record<string, unknown> = {},
		sessionId?: string,
	): Promise<Record<string, unknown>> => {
		if (failure || closed || pending.size >= 32) return Promise.reject(new Error("Browser unavailable"));
		const id = ++sequence;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`, (error) => {
				if (error) fail();
			});
		});
	};
	child.on("error", fail);
	child.on("exit", fail);
	input.on("error", fail);
	output.on("error", fail);
	const buffer = Buffer.alloc(1024 * 1024);
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let length = 0;
	output.on("data", (chunk: Buffer) => {
		if (failure || closing) return;
		if (length + chunk.length > buffer.length) {
			fail();
			return;
		}
		buffer.set(chunk, length);
		length += chunk.length;
		let consumed = 0;
		while (consumed < length) {
			const end = buffer.indexOf(0, consumed);
			if (end < 0 || end >= length) break;
			try {
				const message: unknown = JSON.parse(decoder.decode(buffer.subarray(consumed, end)));
				if (!object(message)) throw new Error("Invalid protocol");
				if (typeof message.id === "number") {
					const reply = pending.get(message.id);
					pending.delete(message.id);
					if (reply) {
						if (message.error || !object(message.result)) reply.reject(new Error("Browser command denied"));
						else reply.resolve(message.result);
					}
				} else if (message.sessionId === session && object(message.params)) {
					const params = message.params;
					if (message.method === "Fetch.requestPaused") {
						if (typeof params.requestId !== "string" || !object(params.request))
							throw new Error("Invalid request");
						const allow =
							params.frameId === rootFrame &&
							params.resourceType === "Document" &&
							params.request.method === "GET" &&
							params.request.url === request.url &&
							documentRequests === 0;
						if (allow) documentRequests++;
						else deniedRequests++;
						void call(
							allow ? "Fetch.continueRequest" : "Fetch.failRequest",
							{
								requestId: params.requestId,
								...(!allow ? { errorReason: "BlockedByClient" } : {}),
							},
							session,
						).catch(fail);
					} else if (message.method === "Page.windowOpen") {
						throw new Error("Popup denied");
					} else if (message.method === "Page.frameNavigated" && object(params.frame)) {
						if (params.frame.parentId || (params.frame.url !== request.url && params.frame.url !== "about:blank"))
							throw new Error("Unexpected navigation");
					} else if (message.method === "Network.responseReceived" && params.type === "Document") {
						if (
							params.frameId !== rootFrame ||
							!object(params.response) ||
							params.response.url !== request.url ||
							params.response.status !== 200 ||
							!["text/html", "text/plain"].includes(String(params.response.mimeType)) ||
							typeof params.requestId !== "string" ||
							documentResponseId !== undefined
						)
							throw new Error("Unsupported document response");
						documentResponseId = params.requestId;
					} else if (message.method === "Network.dataReceived") {
						if (
							params.requestId !== documentResponseId ||
							typeof params.dataLength !== "number" ||
							!Number.isSafeInteger(params.dataLength) ||
							params.dataLength < 0 ||
							typeof params.encodedDataLength !== "number" ||
							!Number.isSafeInteger(params.encodedDataLength) ||
							params.encodedDataLength < 0
						)
							throw new Error("Invalid document byte accounting");
						documentBytes += params.dataLength;
						documentEncodedBytes += params.encodedDataLength;
						if (documentBytes > 262144 || documentEncodedBytes > 262144) throw new Error("Document too large");
					} else if (
						message.method === "Page.lifecycleEvent" &&
						params.name === "load" &&
						typeof params.loaderId === "string"
					) {
						if (loaded.size >= 32) throw new Error("Too many documents");
						loaded.add(params.loaderId);
						wakeLoad?.();
					} else if (
						message.method === "Network.loadingFinished" &&
						typeof params.encodedDataLength === "number" &&
						params.encodedDataLength > 262144
					) {
						throw new Error("Document too large");
					}
				}
			} catch {
				fail();
				return;
			}
			consumed = end + 1;
		}
		if (consumed) {
			buffer.copyWithin(0, consumed, length);
			length -= consumed;
		}
	});
	try {
		const version = await call("Browser.getVersion");
		if (typeof version.product !== "string") throw new Error("No browser identity");
		await call("Browser.setDownloadBehavior", { behavior: "deny" });
		const target = await call("Target.createTarget", { url: "about:blank" });
		if (typeof target.targetId !== "string") throw new Error("No target");
		const attached = await call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
		if (typeof attached.sessionId !== "string") throw new Error("No session");
		session = attached.sessionId;
		await call("Page.enable", {}, session);
		await call("Page.setLifecycleEventsEnabled", { enabled: true }, session);
		await call("Network.enable", {}, session);
		await call("Network.setBypassServiceWorker", { bypass: true }, session);
		await call("Network.setCacheDisabled", { cacheDisabled: true }, session);
		await call(
			"Emulation.setDeviceMetricsOverride",
			{ width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
			session,
		);
		await call("Emulation.setScriptExecutionDisabled", { value: true }, session);
		const tree = await call("Page.getFrameTree", {}, session);
		if (!object(tree.frameTree) || !object(tree.frameTree.frame) || typeof tree.frameTree.frame.id !== "string")
			throw new Error("No frame");
		rootFrame = tree.frameTree.frame.id;
		await call("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, session);
		const navigation = await call("Page.navigate", { url: request.url }, session);
		if (navigation.errorText || navigation.isDownload || typeof navigation.loaderId !== "string")
			throw new Error("Navigation denied");
		while (!loaded.has(navigation.loaderId)) {
			if (failure) throw failure;
			await new Promise<void>((resolve) => {
				wakeLoad = resolve;
			});
		}
		if (failure || deniedRequests || documentRequests !== 1 || !documentResponseId)
			throw new Error("Request policy denied");
		const responseBody = await call("Network.getResponseBody", { requestId: documentResponseId }, session);
		if (typeof responseBody.body !== "string" || typeof responseBody.base64Encoded !== "boolean")
			throw new Error("Missing document body");
		const body = Buffer.from(responseBody.body, responseBody.base64Encoded ? "base64" : "utf8");
		if (body.length > 262144) throw new Error("Document too large");
		const documentDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
		// Page JavaScript cannot see closed declarative shadow roots. Inspect their CDP metadata
		// before accepting a partial light-DOM observation. Native control internals remain allowed.
		const document = await call("DOM.getDocument", { depth: -1, pierce: true }, session);
		const nodes: unknown[] = [document.root];
		while (nodes.length) {
			const node = nodes.pop();
			if (!object(node)) throw new Error("Invalid document");
			if (node.shadowRoots !== undefined) {
				if (
					!Array.isArray(node.shadowRoots) ||
					node.shadowRoots.some((root: unknown) => !object(root) || root.shadowRootType !== "user-agent")
				)
					throw new Error("Unsupported shadow document");
			}
			if (node.children !== undefined) {
				if (!Array.isArray(node.children)) throw new Error("Invalid document");
				for (const child of node.children) nodes.push(child);
			}
		}
		const world = await call(
			"Page.createIsolatedWorld",
			{ frameId: rootFrame, worldName: "weavra-readonly-observation" },
			session,
		);
		if (typeof world.executionContextId !== "number") throw new Error("No isolated observation world");
		const startedAt = Date.now();
		const observations = [];
		for (let index = 0; index < 2; index++) {
			const evaluated = await call(
				"Runtime.evaluate",
				{
					expression: observationExpression,
					contextId: world.executionContextId,
					returnByValue: true,
					awaitPromise: true,
				},
				session,
			);
			if (
				evaluated.exceptionDetails ||
				!object(evaluated.result) ||
				!Check(BrowserObservationSchema, evaluated.result.value)
			)
				throw new Error("Invalid observation");
			if (request.target) {
				const targeted = await call(
					"Runtime.callFunctionOn",
					{
						functionDeclaration: targetExpression,
						executionContextId: world.executionContextId,
						arguments: [{ value: request.target }],
						returnByValue: true,
					},
					session,
				);
				if (
					targeted.exceptionDetails ||
					!object(targeted.result) ||
					!Check(BrowserTargetObservationSchema, targeted.result.value)
				)
					throw new Error("Invalid target observation");
				evaluated.result.value.target = targeted.result.value;
			}
			observations.push(evaluated.result.value);
		}
		if (failure || deniedRequests || JSON.stringify(observations[0]) !== JSON.stringify(observations[1]))
			throw new Error("Unstable or denied observation");
		const result = {
			first: observations[0],
			second: observations[1],
			startedAt,
			finishedAt: Date.now(),
			browserVersion: version.product,
			documentDigest,
		};
		closing = true;
		// Closing the owned browser may close the pipe before its reply. Parent supervision still
		// requires every descendant to exit; no candidate reaches the caller before that check.
		void call("Browser.close").catch(() => undefined);
		await exited;
		console.log(JSON.stringify(result));
	} finally {
		closing = true;
		if (!closed) {
			child.kill("SIGTERM");
			await exited;
		}
	}
}

try {
	await capture();
} catch {
	console.error("Browser observation failed or was denied.");
	process.exitCode = 1;
}
