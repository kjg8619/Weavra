import { sha256 } from "@noble/hashes/sha2";

/**
 * Lowercase hex SHA-256 of the UTF-8 bytes of `text`. Pure JavaScript, so clients can hash
 * synchronously where Web Crypto is missing, such as a page served over plain LAN HTTP.
 */
export function sha256Hex(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
