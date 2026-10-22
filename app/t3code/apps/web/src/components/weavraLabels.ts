import { ko } from "~/i18n/ko";

/** Presentation labels only. Wire values, identifiers and authority stay unchanged. */
const labels: Readonly<Record<string, string>> = ko.runtime.labels.values;

export function weavraLabel(value: string | number | boolean | null | undefined): string {
  if (value == null) return ko.common.unknown;
  if (typeof value === "boolean") return value ? ko.runtime.labels.yes : ko.runtime.labels.no;
  return labels[String(value)] ?? String(value);
}
