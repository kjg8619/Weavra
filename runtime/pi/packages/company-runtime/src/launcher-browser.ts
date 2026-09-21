import {
	BrowserObservationError,
	observeLocalBrowser,
	parseBrowserObservationArguments,
} from "./browser-observation.ts";
import { saveBrowserCandidate } from "./browser-registry.ts";
import { ProcessCleanupError } from "./process-runner.ts";

const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
	const request = parseBrowserObservationArguments(process.argv.slice(2));
	const candidate = await observeLocalBrowser({ ...request, signal: controller.signal });
	controller.signal.throwIfAborted();
	if (request.saveCandidate) await saveBrowserCandidate(process.cwd(), candidate, request.executable);
	controller.signal.throwIfAborted();
	console.log(JSON.stringify(candidate));
} catch (error) {
	console.error(error instanceof ProcessCleanupError ? error.message : new BrowserObservationError().message);
	process.exitCode = 1;
} finally {
	process.removeListener("SIGINT", cancel);
	process.removeListener("SIGTERM", cancel);
}
