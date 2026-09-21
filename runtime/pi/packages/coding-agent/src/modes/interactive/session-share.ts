interface SessionShareContext {
	showError: (message: string) => void;
}

/** Remote sharing is unavailable until a Weavra-owned backend and consent policy exist. */
export async function shareSession(context: SessionShareContext): Promise<void> {
	context.showError("Weavra remote sharing is not configured. Use /export to save a local session file.");
}
