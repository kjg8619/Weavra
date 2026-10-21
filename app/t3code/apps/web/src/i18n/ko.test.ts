import { describe, expect, it } from "vite-plus/test";

import {
  WeavraCanonicalRunStatus,
  WeavraComplexCleanupStatus,
  WeavraComplexPhase,
  WeavraComplexTaskStatusV2,
  WeavraConnectionStatus,
} from "@t3tools/contracts";

import { weavraLabel } from "~/components/weavraLabels";

import { ko } from "./ko";

type Leaf = string | ((...args: never[]) => string);
interface Entry {
  readonly path: string;
  readonly value: Leaf;
}

function walk(node: object, path: string, entries: Entry[], objects: string[]): void {
  objects.push(path);
  for (const [key, value] of Object.entries(node)) {
    const child = `${path}.${key}`;
    if (typeof value === "string" || typeof value === "function")
      entries.push({ path: child, value });
    else if (value && typeof value === "object") walk(value, child, entries, objects);
    else throw new Error(`${child} is neither copy, a copy function nor a namespace`);
  }
}

const entries: Entry[] = [];
const namespaces: string[] = [];
walk(ko, "ko", entries, namespaces);

function namespaceAt(path: string): object {
  return path
    .split(".")
    .slice(1)
    .reduce<object>((node, key) => (node as Record<string, object>)[key]!, ko);
}

function render(fn: (...args: never[]) => string, args: unknown[]): string {
  return (fn as (...values: unknown[]) => string)(...args);
}
function samples(fn: (...args: never[]) => string, variant: 0 | 1): unknown[] {
  const asNumbers = Array.from({ length: fn.length }, (_, index) => (variant ? 7 + index : 1));
  const asStrings = Array.from({ length: fn.length }, (_, index) => `값${variant}${index}`);
  const asLists = asStrings.map((value) => (variant ? [value, `${value}추가`] : [value]));
  for (const candidate of [asNumbers, asStrings, asLists]) {
    try {
      render(fn, candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`${fn.name || "copy function"} rejects number, string and list arguments`);
}

describe("ko catalog", () => {
  it("contains only non-empty copy and copy functions", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const { path, value } of entries) {
      if (typeof value === "string") {
        expect(value.trim(), path).not.toBe("");
      } else {
        expect(typeof render(value, samples(value, 0)), path).toBe("string");
        expect(render(value, samples(value, 0)).trim(), path).not.toBe("");
      }
    }
  });

  it("is immutable at every namespace", () => {
    for (const path of namespaces) expect(Object.isFrozen(namespaceAt(path)), path).toBe(true);
  });

  it("uses every declared parameter of dynamic copy", () => {
    for (const { path, value } of entries) {
      if (typeof value !== "function") continue;
      const base = samples(value, 0);
      const other = samples(value, 1);
      for (let index = 0; index < value.length; index++) {
        const baselines =
          typeof base[index] === "number" ? [0, 1].map((low) => base.with(index, low)) : [base];
        const influences = baselines.some(
          (baseline) =>
            render(value, baseline.with(index, other[index])) !== render(value, baseline),
        );
        expect(influences, `${path} parameter ${index}`).toBe(true);
      }
    }
  });
});

describe("Weavra enum presentation", () => {
  it.each([
    ["run status", WeavraCanonicalRunStatus.literals],
    ["connection status", WeavraConnectionStatus.literals],
    ["complex task status", WeavraComplexTaskStatusV2.literals],
    ["cleanup status", WeavraComplexCleanupStatus.literals],
    ["complex phase", WeavraComplexPhase.literals],
  ] as const)("labels every %s wire value in Korean", (_, values) => {
    for (const value of values) {
      const label = weavraLabel(value);
      expect(label, value).not.toBe(value);
      expect(/[가-힣]/.test(label), value).toBe(true);
    }
  });

  it("keeps an unknown wire value verbatim and copyable", () => {
    expect(weavraLabel("FUTURE_STATUS_V9")).toBe("FUTURE_STATUS_V9");
    expect(weavraLabel(null)).toBe(ko.common.unknown);
  });
});

describe("locale-aware numbers", () => {
  it("groups thousands with the Korean locale in counted copy", () => {
    expect(ko.settings.licenses.noticeCount(12345)).toContain((12345).toLocaleString("ko-KR"));
    expect(ko.settings.licenses.noticeCount(12345)).toContain("12,345");
  });
});
