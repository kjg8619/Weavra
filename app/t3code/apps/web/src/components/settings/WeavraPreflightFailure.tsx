import type { WeavraControlState } from "@t3tools/contracts";

export function WeavraPreflightFailure({
  configuration,
}: {
  configuration: WeavraControlState["snapshot"]["configuration"] | null;
}) {
  return (
    <section aria-label="Runtime 사전 검사 실패" className="space-y-3 text-sm">
      <p className="text-destructive">
        Runtime 사전 검사에서 Run을 만들지 못했어요. 자동 재시도는 하지 않았어요.
      </p>
      {configuration ? (
        <>
          <p className="text-xs text-muted-foreground">
            현재 프로젝트 설정이며 Run에서 확정한 설정은 아니에요.
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
            {[
              ["상태", configuration.status],
              ["등록된 검사", configuration.registeredCheckCount ?? "확인 안 됨"],
              ["필수 검사", configuration.requiredCheckCount ?? "확인 안 됨"],
              ...Object.entries(configuration.modes ?? {}),
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          현재 설정을 확인할 수 없어요. 다시 연결해 새 스냅샷을 확인한 뒤 준비해 주세요.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Runtime 호스트에서 이 프로젝트 디렉터리를 열고 다음 명령을 실행해 주세요:{" "}
        <code className="break-words">weavra project doctor</code>. 로컬 차단 사유를 해결해 주세요.
        준비 조건을 통과했다면 모델 프로필과 인증을 확인한 뒤 다시 준비해 주세요. 이 진단은 등록
        검사를 실행하거나 모델 인증을 검증하지 않아요.
      </p>
    </section>
  );
}
