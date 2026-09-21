import { afterEach, expect, it, vi } from "vite-plus/test";
// Re-import after setting env: legal destinations are captured at module initialization.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("does not treat upstream policies as Weavra policies without configuration", async () => {
  vi.stubEnv("EXPO_PUBLIC_MARKETING_SITE_URL", "");
  const legal = await import("./legal-document-url");
  expect(legal.LEGAL_URL).toBeNull();
  expect(legal.isLegalDocumentUrl("https://t3.codes/legal")).toBe(false);
});

it("limits legal navigation to the explicitly configured documents", async () => {
  vi.stubEnv("EXPO_PUBLIC_MARKETING_SITE_URL", "https://legal.example.test/");
  const { isLegalDocumentUrl } = await import("./legal-document-url");
  expect(isLegalDocumentUrl("https://legal.example.test/legal/?source=app")).toBe(true);
  expect(isLegalDocumentUrl("https://legal.example.test/privacy-policy#updates")).toBe(true);
  expect(isLegalDocumentUrl("https://t3.codes/legal")).toBe(false);
  expect(isLegalDocumentUrl("https://legal.example.test/download")).toBe(false);
  expect(isLegalDocumentUrl("javascript:alert(1)")).toBe(false);
});
