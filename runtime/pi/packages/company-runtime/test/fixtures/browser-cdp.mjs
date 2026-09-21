import { appendFileSync, readFileSync, writeSync } from "node:fs";
import { createReadStream } from "node:fs";

// A deterministic CDP peer, not Chromium. Actual Chromium scenarios are verified separately.
// Tests copy this beside capture.json and prepend the current Node executable's shebang.
const settings = JSON.parse(readFileSync(new URL("./capture.json", import.meta.url), "utf8"));
const trace = new URL("./captures.jsonl", import.meta.url);
appendFileSync(trace, `${JSON.stringify({ pid: process.pid, home: process.env.HOME, profile: process.argv.find(value => value.startsWith("--user-data-dir="))?.slice(16) })}\n`);
if (settings.mode === "unavailable") process.exit(1);
const sessionId = "fixture-session";
const frameId = "fixture-frame";
const loaderId = "fixture-loader";
const requestId = "fixture-document";
let url;
let buffer = "";
let evaluated = 0;
const send = message => writeSync(4, `${JSON.stringify(message)}\0`);
const event = (method, params) => send({ method, params, sessionId });
function handle(message) {
	const { method, params = {} } = message;
	let result = {};
	if (method === "Browser.getVersion") result = { product: "HeadlessChrome/CDP-fixture" };
	else if (method === "Target.createTarget") result = { targetId: "fixture-target" };
	else if (method === "Target.attachToTarget") result = { sessionId };
	else if (method === "Page.getFrameTree") result = { frameTree: { frame: { id: frameId } } };
	else if (method === "Page.navigate") {
		url = params.url;
		result = settings.mode === "download" ? { isDownload: true } : { loaderId };
	} else if (method === "Network.getResponseBody") {
		result = { body: `<p id="status">${settings.value ?? "Ready"}</p>`, base64Encoded: false };
	} else if (method === "DOM.getDocument") result = { root: { children: [] } };
	else if (method === "Page.createIsolatedWorld") result = { executionContextId: 1 };
	else if (method === "Runtime.evaluate") {
		evaluated++;
		result = { result: { value: {
			url, title: "CDP fixture", text: settings.text ?? settings.value ?? "Ready",
			markerDigest: "a".repeat(64), elements: [], omittedElements: 0,
			...(settings.observationExtras ?? {}),
		} } };
	} else if (method === "Runtime.callFunctionOn") {
		const target = params.arguments[0].value;
		result = { result: { value: {
			target, exists: settings.exists !== false,
			value: settings.exists === false ? null : settings.mode === "changing" && evaluated > 1 ? "Broken" : settings.value ?? "Ready",
		} } };
	}
	send({ id: message.id, result, ...(message.sessionId ? { sessionId: message.sessionId } : {}) });
	if (method === "Browser.close") process.exit(0);
	if (method === "Page.navigate" && settings.mode !== "download") {
		event("Fetch.requestPaused", { requestId, frameId, resourceType: "Document", request: { method: "GET", url } });
	}
	if (method === "Fetch.continueRequest") {
		if (settings.mode === "redirect" || settings.mode === "external" || settings.mode === "subresource") {
			event("Fetch.requestPaused", {
				requestId: "unexpected", frameId,
				resourceType: settings.mode === "subresource" ? "Image" : "Document",
				request: { method: "GET", url: settings.mode === "external" ? "https://example.invalid/" : `${url}/other` },
			});
		}
		event("Network.responseReceived", { requestId, frameId, type: "Document", response: { url, status: 200, mimeType: "text/html" } });
		if (settings.mode === "streaming-oversize") {
			event("Network.dataReceived", { requestId, dataLength: 262145, encodedDataLength: 1024 });
			return; // Never finish loading: the byte fence, not load completion, must stop capture.
		}
		event("Page.lifecycleEvent", { frameId, name: "load", loaderId });
	}
}
createReadStream(null, { fd: 3 }).on("data", chunk => {
	buffer += chunk.toString("utf8");
	for (;;) {
		const end = buffer.indexOf("\0");
		if (end < 0) break;
		const message = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		handle(message);
	}
});
