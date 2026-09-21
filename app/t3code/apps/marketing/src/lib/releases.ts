// Historical links on the explicitly labeled legacy T3 marketing site, not Weavra releases.
const REPO = "pingdotgg/t3code";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const NIGHTLY_RELEASES_URL = `${RELEASES_URL}?q=nightly&expanded=true`;

export type ReleaseChannel = "stable" | "nightly";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: ReleaseAsset[];
}

/** The inherited marketing site is not a Weavra distribution channel. */
export async function fetchLatestRelease(_channel: ReleaseChannel = "stable"): Promise<Release> {
  throw new Error("Weavra downloads are unavailable: no Weavra release channel is configured.");
}
