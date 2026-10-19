/**
 * Korean authored-copy catalog: immutable namespaces, dynamic copy as functions
 * of their parameters. Wire enums, identifiers, commands, URLs, license text and
 * user content are data, never entries; enum presentation stays in weavraLabels.
 */
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

export const ko = freeze({
  common: freeze({
    project: "프로젝트",
    conversation: "대화",
    controlledTask: "통제 작업",
    runHistory: "실행 기록",
    provider: "공급자",
    approvalRequired: "승인 필요",
    fullAccess: "전체 접근",
    connection: "연결",
    settings: "설정",
    archive: "보관함",
    cancel: "취소",
    close: "닫기",
    confirm: "확인",
    retry: "다시 시도",
    unknown: "확인 안 됨",
    rawDiagnostics: "원문 진단",
  }),
  onboarding: freeze({
    connectComputer: "컴퓨터 연결하기",
    chooseProject: "프로젝트 선택하기",
    continue: "계속하기",
    skipProject: "프로젝트 가져오지 않기",
    availableAgents: "선택한 컴퓨터에서 사용할 수 있는 에이전트예요.",
  }),
  chat: freeze({
    send: "메시지 보내기",
    queue: "대기열에 메시지 추가",
    scrollToLatest: "맨 아래로 이동",
    dropToAttach: "파일을 놓아 첨부해 주세요",
    selection: freeze({
      quote: "인용",
      shorten: "선택 줄이기",
      quoteSelection: "선택한 내용을 작성기에 인용",
      selectionTooLong: "선택한 내용이 너무 길어 인용할 수 없어요",
    }),
    media: freeze({
      expand: (label: string) => `${label} 크게 보기`,
      closePreview: (label: string) => `${label} 미리보기 닫기`,
      previous: "이전 미디어",
      next: "다음 미디어",
    }),
  }),
  projects: freeze({
    add: "프로젝트 추가",
    localFolder: "로컬 폴더",
    openPanel: "패널 열기",
    addPanel: "패널 추가",
    controlSettings: (project: string) => `${project} 통제 설정`,
  }),
  providers: freeze({
    dismissUpdateNotice: "제공자 업데이트 알림 닫기",
    loginRequired: "로그인 필요",
    installRequired: "설치 필요",
    updateAvailable: (provider: string) => `${provider} 업데이트가 있어요`,
  }),
  settings: freeze({
    general: "일반",
    appearance: "모양",
    keybindings: "키보드 단축키",
    snapshots: "스냅샷",
    integrations: "연동",
    sourceControl: "소스 제어",
    storage: "저장 공간",
    diagnostics: "진단",
    licenses: "라이선스",
  }),
  runtime: freeze({
    executionControl: "Runtime 실행 제어",
    executionMode: "실행 모드",
    prepareWorkflow: "워크플로 준비",
    evidenceSummary: "증거 요약",
    loadHistory: "기록 불러오기",
    phaseUnknown: "단계 확인 안 됨",
    lastObserved: (when: string) => `마지막 관찰 ${when}`,
  }),
  devices: freeze({
    devices: "기기",
    browser: "브라우저",
    terminal: "터미널",
    files: "파일",
    agents: "에이전트",
    runGraph: "Run 그래프",
  }),
});

export type KoCatalog = typeof ko;
