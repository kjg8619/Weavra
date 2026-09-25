import { describe, expect, it } from "vite-plus/test";
import { sha256Hex } from "./sha256.ts";

describe("sha256Hex", () => {
  it("hashes the UTF-8 bytes of a string to lowercase hex", () => {
    // FIPS 180-2 test vectors.
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    // Multi-byte text hashes its UTF-8 bytes (ED 95 9C), not UTF-16 code units.
    expect(sha256Hex("한")).toBe(
      "89233692031a62c60e6ef602b4cd9f3cb52a6dd8013fe9873c36101a7e3920e0",
    );
  });
});
