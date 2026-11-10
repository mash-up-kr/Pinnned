// 노션 QA 행의 제목·현상·재현 절차·본문 — 현업 QA 리포트 형식. 개발자가 아닌 팀원도 바로 읽을 수 있게 쓴다.
import type { ErrorReport, ErrorReportKind } from "@/shared/api/error-reporter"

const RICH_TEXT_LIMIT = 2000

// 라우트 패턴 → 화면 이름. 라우트가 늘면 여기도 추가 (src/app/routes 파일명 기준)
const SCREEN_NAMES: Record<string, string> = {
  "/": "랜딩",
  "/map-google": "지도",
  "/my-page": "마이페이지",
  "/my-page/pot/$potId": "팟 상세",
  "/my-page/feedback": "피드백 보내기",
  "/my-page/profile-edit": "프로필 수정",
  "/my-page/blocked-users": "차단 사용자 관리",
  "/pot-create": "팟 만들기",
  "/pot-join": "팟 참여",
  "/pot-start": "팟 시작",
  "/signup": "회원가입",
  "/travel-album": "여행 앨범",
  "/travel-album/$region": "지역 앨범",
  "/i/$code": "초대 링크",
  "/login/callback": "로그인 콜백",
  "/login/app-start": "앱 로그인 시작",
}

/** 노션 `종류` select 옵션 이름. scripts/qa-notion/lib.mjs와 같아야 한다. */
export const KIND_LABELS: Record<ErrorReportKind, string> = {
  "js-error": "동작 오류",
  "promise-rejection": "비동기 오류",
  "render-error": "화면 표시 오류",
  "ssr-error": "페이지 로드 실패",
  "api-failure": "서버 요청 실패",
}

export type Severity = "치명" | "높음" | "보통" | "낮음"

export function screenName(routePattern: string | undefined): string {
  if (!routePattern) return "알 수 없음"
  return SCREEN_NAMES[routePattern] ?? routePattern
}

const MESSAGE_TRANSLATIONS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /^Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)/,
    (m) => `'${m[1]}' 값을 읽으려 했지만 데이터가 비어 있음`,
  ],
  [/^(\S+) is not a function/, (m) => `'${m[1]}'이(가) 함수가 아님`],
  [/^Failed to fetch|^Load failed|^NetworkError/, () => "네트워크 연결 실패"],
  [/^(\S+) is not defined/, (m) => `'${m[1]}'이(가) 정의되지 않음`],
]

export function humanizeMessage(message: string): string {
  for (const [pattern, translate] of MESSAGE_TRANSLATIONS) {
    const match = message.match(pattern)
    if (match) return translate(match)
  }
  return message.slice(0, 80)
}

const isServerError = (report: ErrorReport) =>
  report.kind === "api-failure" && (report.api?.status ?? 0) >= 500

/** 자동 부여 초기값. 사람·주간 분석이 조정한다. 치명·낮음은 자동으로 주지 않는다. */
export function severityOf(report: ErrorReport): Severity {
  if (report.kind === "ssr-error" || report.kind === "render-error")
    return "높음"
  if (isServerError(report)) return "높음"
  return "보통"
}

function apiShort(report: ErrorReport): string {
  const api = report.api
  if (!api) return report.message
  return `${api.name} ${api.status ?? "네트워크"}${api.code ? ` ${api.code}` : ""}`
}

/** 표 제목 "[화면] 증상" */
export function buildRowTitle(report: ErrorReport): string {
  const screen = `[${screenName(report.routePattern)}]`
  switch (report.kind) {
    case "api-failure":
      return `${screen} 서버 요청 실패 (${apiShort(report)})`
    case "render-error":
      return `${screen} 화면 표시 오류 – ${humanizeMessage(report.message)}`
    case "ssr-error":
      return `${screen} 페이지 로드 실패 – ${humanizeMessage(report.message)}`
    default:
      return `${screen} 동작 오류 – ${humanizeMessage(report.message)}`
  }
}

/** 현상(실제 결과): 사용자 관점 한 문장 */
export function buildSymptom(report: ErrorReport): string {
  const screen = `${screenName(report.routePattern)} 화면`
  switch (report.kind) {
    case "api-failure": {
      const api = report.api
      const cause = api?.status
        ? `${api.status} 오류로`
        : api
          ? "네트워크 문제로"
          : ""
      return `${screen}에서 서버 요청${api ? `(${api.name})` : ""}이 ${cause} 실패해 데이터가 표시되지 않거나 동작이 완료되지 않음`
    }
    case "render-error":
      return `${screen}이 정상 표시되지 않고 '문제가 발생했어요' 화면이 뜸`
    case "ssr-error":
      return `${screen}이 열리지 않음 (서버가 페이지를 만들지 못함: ${humanizeMessage(report.message)})`
    default:
      return `${screen}에서 ${humanizeMessage(report.message)} — 버튼이나 동작이 반응하지 않았을 수 있음`
  }
}

/** 기대 결과: 종류별 정상 동작 */
export function buildExpected(report: ErrorReport): string {
  switch (report.kind) {
    case "api-failure":
      return "요청이 정상 처리되어 데이터가 표시된다"
    case "render-error":
      return "화면이 정상 표시된다"
    case "ssr-error":
      return "페이지가 정상 로드된다"
    default:
      return "오류 없이 동작이 완료된다"
  }
}

const AUTO_NOTE = "오류 발생 (자동 수집 — 정확한 조작은 재현 확인 필요)"

/** 재현 절차: 이동 경로를 번호 절차로 */
export function buildReproSteps(report: ErrorReport): Array<string> {
  const path = report.breadcrumbs.length
    ? report.breadcrumbs
    : report.routePattern
      ? [report.routePattern]
      : []
  const steps = path.map((route, index) =>
    index === 0
      ? `${screenName(route)} 화면 진입`
      : `${screenName(route)} 화면으로 이동`
  )
  return [...steps, AUTO_NOTE]
}

/** "iPhone · Safari" */
export function describeDevice(userAgent: string): string {
  const device = /iPhone|iPad/.test(userAgent)
    ? "iPhone"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows PC"
        : /Macintosh/.test(userAgent)
          ? "Mac"
          : "기타"
  const browser = /SamsungBrowser/.test(userAgent)
    ? "Samsung 브라우저"
    : /Chrome|CriOS/.test(userAgent)
      ? "Chrome"
      : /Safari/.test(userAgent)
        ? "Safari"
        : "기타"
  return `${device} · ${browser}`
}

/** 표의 `환경` 속성 한 줄 */
export function buildEnvironment(report: ErrorReport): string {
  return `${describeDevice(report.userAgent)} · ${report.viewport} · v${report.appVersion}`
}

type RichText = Array<{ text: { content: string } }>
const rich = (content: string): RichText => [{ text: { content } }]
const chunks = (content: string): RichText => {
  const parts: RichText = []
  for (let i = 0; i < content.length; i += RICH_TEXT_LIMIT)
    parts.push({ text: { content: content.slice(i, i + RICH_TEXT_LIMIT) } })
  return parts.length ? parts : rich("")
}

/** 이 모듈이 만드는 노션 블록만 표현한다 (전체 API 스키마 아님) */
export interface NotionBlock {
  object: "block"
  type:
    | "heading_2"
    | "bulleted_list_item"
    | "numbered_list_item"
    | "paragraph"
    | "code"
    | "callout"
    | "toggle"
  heading_2?: { rich_text: RichText }
  bulleted_list_item?: { rich_text: RichText }
  numbered_list_item?: { rich_text: RichText }
  paragraph?: { rich_text: RichText }
  code?: { language: string; rich_text: RichText }
  callout?: { icon: { emoji: string }; rich_text: RichText }
  toggle?: { rich_text: RichText; children: Array<NotionBlock> }
}

const heading = (text: string): NotionBlock => ({
  object: "block",
  type: "heading_2",
  heading_2: { rich_text: rich(text) },
})
const bullet = (text: string): NotionBlock => ({
  object: "block",
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: rich(text) },
})
const numbered = (text: string): NotionBlock => ({
  object: "block",
  type: "numbered_list_item",
  numbered_list_item: { rich_text: rich(text) },
})
const paragraph = (text: string): NotionBlock => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: rich(text) },
})
const code = (text: string): NotionBlock => ({
  object: "block",
  type: "code",
  code: { language: "plain text", rich_text: chunks(text) },
})

/**
 * 페이지 본문 (QA 리포트): 현상 → 재현 절차 → 기대/실제 결과 → 발생 환경 → 첨부(사람이 채움) → 접힌 개발자 참고.
 */
export function buildRowBlocks(
  report: ErrorReport,
  stack: { text: string; resolved: boolean }
): Array<NotionBlock> {
  const occurred = new Date(report.occurredAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
  })

  const developer: Array<NotionBlock> = []
  if (report.stack)
    developer.push(
      paragraph(
        stack.resolved
          ? "스택 (원본 소스 위치로 복원됨)"
          : "스택 (소스맵 복원 실패 — 압축된 위치 그대로)"
      ),
      code(stack.text || report.stack)
    )
  if (report.componentStack)
    developer.push(
      paragraph("React 컴포넌트 트리"),
      code(report.componentStack)
    )
  if (report.api)
    developer.push(
      paragraph(
        `API: ${report.api.protocol} ${report.api.name} status=${report.api.status ?? "-"} code=${report.api.code ?? "-"}`
      )
    )
  developer.push(
    paragraph(
      `원본 메시지: ${report.name ? `${report.name}: ` : ""}${report.message}`
    ),
    paragraph(`User-Agent: ${report.userAgent}`),
    paragraph(
      `라우트: ${report.routePattern ?? "-"} · occurredAt: ${report.occurredAt}`
    )
  )

  return [
    {
      object: "block",
      type: "callout",
      callout: { icon: { emoji: "🐞" }, rich_text: rich(buildSymptom(report)) },
    },
    heading("재현 절차"),
    ...buildReproSteps(report).map(numbered),
    heading("기대 결과"),
    bullet(buildExpected(report)),
    heading("발생 환경"),
    bullet(
      `기기: ${describeDevice(report.userAgent)} (${report.viewport}) · 앱 버전: ${report.appVersion}`
    ),
    bullet(
      `로그인: ${report.authenticated ? "됨" : "안 됨"} · 네트워크: ${report.online ? "온라인" : "오프라인"} · 최초 발생: ${occurred} (KST)`
    ),
    heading("첨부"),
    paragraph("스크린샷이나 추가 설명이 있으면 여기에 넣어 주세요."),
    heading("개발자 참고"),
    {
      object: "block",
      type: "toggle",
      toggle: {
        rich_text: rich("스택 · API · 원본 로그 (펼치기)"),
        children: developer,
      },
    },
  ]
}
