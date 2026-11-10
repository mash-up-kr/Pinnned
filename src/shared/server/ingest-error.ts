import { computeFingerprint } from "./fingerprint"
import { createQaNotionClient } from "./qa-notion"
import {
  KIND_LABELS,
  buildEnvironment,
  buildRowBlocks,
  buildRowTitle,
  buildSymptom,
  screenName,
  severityOf,
} from "./row-content"
import { resolveStack } from "./stack-resolver"
import type { ErrorReport, ErrorReportKind } from "@/shared/api/error-reporter"
import type { QaNotionClient } from "./qa-notion"
import { normalizeRestPath } from "@/shared/api/error-reporter"

const KINDS: ReadonlySet<string> = new Set<ErrorReportKind>([
  "js-error",
  "promise-rejection",
  "render-error",
  "ssr-error",
  "api-failure",
])
const MAX_STACK = 16_000
const MAX_MESSAGE = 1_000

/** 신뢰 경계: 클라이언트 본문을 검사한다. kind 화이트리스트·필수 문자열·길이 상한. 어긋나면 null. */
export function parseErrorReport(body: unknown): ErrorReport | null {
  if (typeof body !== "object" || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.kind !== "string" || !KINDS.has(b.kind)) return null
  if (typeof b.message !== "string") return null

  const str = (v: unknown, max: number) =>
    typeof v === "string" ? v.slice(0, max) : undefined

  return {
    kind: b.kind as ErrorReportKind,
    message: b.message.slice(0, MAX_MESSAGE),
    name: str(b.name, 200),
    stack: str(b.stack, MAX_STACK),
    componentStack: str(b.componentStack, MAX_STACK),
    routePattern: str(b.routePattern, 300),
    breadcrumbs: Array.isArray(b.breadcrumbs)
      ? b.breadcrumbs
          .filter((x): x is string => typeof x === "string")
          .slice(0, 5)
      : [],
    userAgent: str(b.userAgent, 500) ?? "",
    viewport: str(b.viewport, 20) ?? "",
    online: b.online !== false,
    authenticated: b.authenticated === true,
    appVersion: str(b.appVersion, 40) ?? "unknown",
    occurredAt:
      typeof b.occurredAt === "string" &&
      !Number.isNaN(Date.parse(b.occurredAt))
        ? b.occurredAt
        : new Date().toISOString(),
    api: parseApi(b.api),
  }
}

function parseApi(value: unknown): ErrorReport["api"] {
  if (typeof value !== "object" || value === null) return undefined
  const a = value as Record<string, unknown>
  if (
    (a.protocol !== "graphql" && a.protocol !== "rest") ||
    typeof a.name !== "string"
  )
    return undefined
  return {
    protocol: a.protocol,
    name: a.name.slice(0, 300),
    status: typeof a.status === "number" ? a.status : undefined,
    code: typeof a.code === "string" ? a.code.slice(0, 100) : undefined,
  }
}

/** 표에서 한눈에 볼 "오류 위치": 복원된 최상위 프레임 → 없으면 압축 스택의 첫 프레임 → API 요청 이름 */
function locationOf(
  report: ErrorReport,
  stack: { topFrame?: string }
): string | undefined {
  if (stack.topFrame) return stack.topFrame
  const firstFrame = report.stack
    ?.split("\n")
    .slice(1)
    .map((line) => /((?:https?:\/\/|src\/)[^\s)]+)/.exec(line)?.[1])
    .find(Boolean)
  if (firstFrame) return firstFrame.replace(/^https?:\/\/[^/]+\//, "")
  return report.api ? `${report.api.protocol} ${report.api.name}` : undefined
}

/**
 * 리포트 하나를 노션에 upsert한다. 같은 지문이면 횟수+1, 해결된 행이면 재발.
 * ponytail: 조회→생성 사이에 같은 지문이 겹치면 행이 2개 생길 수 있다. 노션엔 원자적 upsert가 없다.
 */
export async function ingestErrorReport(
  report: ErrorReport,
  deps: {
    notion: QaNotionClient
    fetchMap: (mapUrl: string) => Promise<string | null>
  }
): Promise<void> {
  const stack = report.stack
    ? await resolveStack(report.stack, {
        fetchMap: (url) => deps.fetchMap(url).catch(() => null),
      })
    : { text: "", resolved: false, topFrame: undefined }

  const fingerprint = await computeFingerprint(report, stack.topFrame)
  const existing = await deps.notion.findByFingerprint(fingerprint)

  if (existing) {
    await deps.notion.bumpRow(existing.pageId, {
      count: existing.count + 1,
      occurredAt: report.occurredAt,
      environment: buildEnvironment(report),
      reopen: existing.status === "해결",
    })
    return
  }

  await deps.notion.createRow({
    title: buildRowTitle(report),
    symptom: buildSymptom(report),
    kindLabel: KIND_LABELS[report.kind],
    severity: severityOf(report),
    screen: report.routePattern
      ? `${screenName(report.routePattern)} (${report.routePattern})`
      : undefined,
    fingerprint,
    environment: buildEnvironment(report),
    occurredAt: report.occurredAt,
    location: locationOf(report, stack),
    children: buildRowBlocks(report, stack),
  })
}

// 동적 라우트. 클라이언트 리포트의 routePattern(라우터 fullPath)과 같은 문자열이어야 같은 지문으로 묶인다.
// ponytail: 라우트 트리를 import하면 report-error 라우트와 순환이 생겨 손으로 적는다. 동적 라우트가 늘면 여기도 추가.
const DYNAMIC_ROUTES: Array<[RegExp, string]> = [
  [/^\/i\/[^/]+\/?$/, "/i/$code"],
  [/^\/my-page\/pot\/[^/]+\/?$/, "/my-page/pot/$potId"],
  [/^\/travel-album\/[^/]+\/?$/, "/travel-album/$region"],
]

function toRoutePattern(pathname: string): string {
  const matched = DYNAMIC_ROUTES.find(([pattern]) => pattern.test(pathname))
  return matched ? matched[1] : normalizeRestPath(pathname)
}

/**
 * 서버 엔트리용. SSR 예외·5xx를 ssr-error로 기록한다. env가 없거나 실패하면 조용히 넘어간다.
 * /report-error 자체의 실패는 기록하지 않는다 (재귀 방지).
 */
export async function ingestServerError(
  request: Request,
  error: unknown
): Promise<void> {
  try {
    const url = new URL(request.url)
    if (url.pathname === "/report-error") return
    const token = process.env.NOTION_TOKEN
    const databaseId = process.env.NOTION_QA_DB_ID
    if (!token || !databaseId) return

    const shape =
      error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : { message: String(error) }
    await ingestErrorReport(
      {
        kind: "ssr-error",
        ...shape,
        routePattern: toRoutePattern(url.pathname),
        breadcrumbs: [],
        userAgent: request.headers.get("user-agent") ?? "",
        viewport: "",
        online: true,
        authenticated: false,
        appVersion: import.meta.env.VITE_APP_VERSION,
        occurredAt: new Date().toISOString(),
      },
      {
        notion: createQaNotionClient({ token, databaseId }),
        // 서버 번들 소스맵은 HTTP로 노출되지 않는다 — 복원 없이 원본 스택을 남긴다
        fetchMap: () => Promise.resolve(null),
      }
    )
  } catch {
    // 기록 실패는 삼킨다
  }
}
