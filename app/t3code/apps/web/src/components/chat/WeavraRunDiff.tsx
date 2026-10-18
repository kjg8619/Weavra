import { FileDiff } from "@pierre/diffs/react";
import type { WeavraEvidenceRecord } from "@t3tools/contracts";
import { useTheme } from "../../hooks/useTheme";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../../lib/syntaxHighlighting";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";

export type RunDiffRecord = Extract<WeavraEvidenceRecord, { category: "run-diff" }>;
const changeLabels = { added: "추가", modified: "수정", deleted: "삭제" } as const;
const omittedLabels = {
  DIFF_TOO_LARGE: "이 파일의 변경이 표시 한도(32 KiB)를 넘어 내용을 보여 주지 않아요.",
  NOT_TEXT: "텍스트 파일이 아니어서 내용을 보여 주지 않아요.",
} as const;

export function WeavraRunDiff({ records }: { records: readonly RunDiffRecord[] }) {
  const { resolvedTheme } = useTheme();
  return (
    <DiffWorkerPoolProvider>
      {records.map((record) => {
        const patch = record.patch
          ? getRenderablePatch(record.patch, `weavra-run-diff:${record.index}`)
          : null;
        return (
          <div
            key={record.index}
            data-weavra="run-diff-file"
            data-path={record.path}
            className="min-w-0 space-y-1 rounded-lg border border-border/70 p-2 text-xs"
          >
            <p className="font-mono [overflow-wrap:anywhere]">
              <span className="text-muted-foreground">{changeLabels[record.change]}</span>{" "}
              {record.path}
            </p>
            {record.omitted ? (
              <p className="text-muted-foreground">{omittedLabels[record.omitted]}</p>
            ) : patch?.kind === "files" ? (
              patch.files.map((fileDiff) => (
                <FileDiff
                  key={resolveFileDiffPath(fileDiff)}
                  fileDiff={fileDiff}
                  options={{
                    collapsed: false,
                    diffStyle: "unified",
                    theme: resolveDiffThemeName(resolvedTheme),
                    preferredHighlighter: PREFERRED_HIGHLIGHTER,
                  }}
                />
              ))
            ) : patch?.kind === "raw" ? (
              <pre className="overflow-x-auto rounded-md bg-muted/40 p-2">{patch.text}</pre>
            ) : null}
          </div>
        );
      })}
    </DiffWorkerPoolProvider>
  );
}
