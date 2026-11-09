import { computeFingerprint } from "./fingerprint"
import { createQaNotionClient } from "./qa-notion"
import { resolveStack } from "./stack-resolver"
import type { ErrorReport, ErrorReportKind } from "@/shared/api/error-reporter"
import type { QaNotionClient } from "./qa-notion"

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

/** 노션 본문: 복원 스택 → 컴포넌트 스택 → 브레드크럼 → 환경 순. 사람이 위에서부터 읽는다. */
function buildStackText(
  report: ErrorReport,
  stack: { text: string; resolved: boolean }
): string {
  const sections: Array<string> = []
  if (report.stack)
    sections.push((stack.resolved ? "" : "(소스맵 복원 실패)\n") + stack.text)
  if (report.componentStack)
    sections.push(`[컴포넌트]\n${report.componentStack}`)
  if (report.api)
    sections.push(
      `[API] ${report.api.protocol} ${report.api.name} status=${report.api.status ?? "-"} code=${report.api.code ?? "-"}`
    )
  if (report.breadcrumbs.length)
    sections.push(`[경로] ${report.breadcrumbs.join(" → ")}`)
  sections.push(
    `[환경] ${report.userAgent} / ${report.viewport} / online=${report.online} / auth=${report.authenticated} / v=${report.appVersion}`
  )
  return sections.join("\n\n")
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
      appVersion: report.appVersion,
      reopen: existing.status === "해결",
    })
    return
  }

  await deps.notion.createRow({
    title: `[${report.kind}] ${report.message.slice(0, 80)}`,
    kind: report.kind,
    route: report.routePattern,
    fingerprint,
    appVersion: report.appVersion,
    occurredAt: report.occurredAt,
    stackText: buildStackText(report, stack),
  })
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
        routePattern: url.pathname,
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
