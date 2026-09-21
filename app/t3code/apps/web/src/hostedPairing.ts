import { getPairingTokenFromUrl } from "./pairingUrl";

export interface HostedPairingRequest {
  readonly host: string;
  readonly token: string;
  readonly label: string;
}

// No hosted Weavra app is provisioned. Legacy URLs and release-channel variables
// must not bypass the local server's authentication bootstrap.
export function isHostedStaticApp(_url?: URL): boolean {
  return false;
}

// Explicit host+token links can still pair a direct environment from this app.
export function readHostedPairingRequest(url: URL = new URL(window.location.href)) {
  const host = url.searchParams.get("host")?.trim() ?? "";
  const token = getPairingTokenFromUrl(url)?.trim() ?? "";
  const label = url.searchParams.get("label")?.trim() ?? "";
  if (!host || !token) return null;
  return { host, token, label } satisfies HostedPairingRequest;
}

export function hasHostedPairingRequest(url: URL = new URL(window.location.href)): boolean {
  return readHostedPairingRequest(url) !== null;
}
