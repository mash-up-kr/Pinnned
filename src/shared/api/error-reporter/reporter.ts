import { CLARITY_TAG_KEY, clarityErrorTag } from "./clarity"
import { shouldIgnoreError } from "./filter"

export type ErrorReportKind =
  | "js-error"
  | "promise-rejection"
  | "render-error"
  | "ssr-error"
  | "api-failure"

export interface ErrorReport {
  kind: ErrorReportKind
  message: string
  /** Error.name */
  name?: string
  /** 압축 상태 원본 스택 — 서버가 소스맵으로 복원한다 */
  stack?: string
  componentStack?: string
  /** 라우트 패턴. 예 "/my-page/pot/$potId" */
  routePattern?: string
  /** 최근 라우트 패턴, 오래된 것부터 최대 5개 */
  breadcrumbs: Array<string>
  userAgent: string
  /** "390x844" */
  viewport: string
  online: boolean
  authenticated: boolean
  appVersion: string
  /** ISO 8601 */
  occurredAt: string
  api?: {
    protocol: "graphql" | "rest"
    /** operationName 또는 "POST /api/auth/exchange" */
    name: string
    status?: number
    /** GraphQL extensions.code */
    code?: string
  }
}

export const REPORT_ENDPOINT = "/report-error"
const MAX_REPORTS_PER_SESSION = 20
const MAX_BREADCRUMBS = 5
const PRODUCTION_HOST = "www.pinnned.co.kr"

interface ReporterState {
  enabled: boolean
  installed: boolean
  isAuthenticated: () => boolean
  sentKeys: Set<string>
  sentCount: number
  breadcrumbs: Array<string>
}

function initialState(): ReporterState {
  return {
    enabled: false,
    installed: false,
    isAuthenticated: () => false,
    sentKeys: new Set(),
    sentCount: 0,
    breadcrumbs: [],
  }
}

let state = initialState()

function isProductionHost(): boolean {
  return (
    import.meta.env.PROD &&
    typeof location !== "undefined" &&
    location.hostname === PRODUCTION_HOST
  )
}

function toErrorShape(error: unknown): {
  message: string
  name?: string
  stack?: string
} {
  if (error instanceof Error)
    return { message: error.message, name: error.name, stack: error.stack }
  return { message: String(error) }
}

function send(report: ErrorReport): void {
  const json = JSON.stringify(report)
  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(
      REPORT_ENDPOINT,
      new Blob([json], { type: "application/json" })
    )
    return
  }
  // 전송 실패는 보고 대상이 아니다 — 여기서 삼켜 unhandledrejection 재귀를 막는다
  void fetch(REPORT_ENDPOINT, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: json,
  }).catch(() => {})
}

function enqueue(partial: Omit<ErrorReport, keyof BaseFields>): void {
  if (!state.enabled) return
  if (state.sentCount >= MAX_REPORTS_PER_SESSION) return
  if (shouldIgnoreError({ message: partial.message, stack: partial.stack }))
    return

  const key = `${partial.kind}|${partial.api?.name ?? partial.message}|${partial.stack?.split("\n")[1] ?? ""}`
  if (state.sentKeys.has(key)) return
  state.sentKeys.add(key)
  state.sentCount += 1

  tagClaritySession(partial)
  send({ ...partial, ...baseFields() })
}

declare global {
  interface Window {
    clarity?: (...args: Array<unknown>) => void
  }
}

/** Clarity 녹화에 error 태그를 달고 이 세션을 우선 저장시킨다 (무료 플랜은 녹화를 샘플링한다). */
function tagClaritySession(report: Pick<ErrorReport, "kind" | "message">) {
  const clarity = window.clarity
  if (typeof clarity !== "function") return
  clarity("set", CLARITY_TAG_KEY, clarityErrorTag(report))
  clarity("upgrade", CLARITY_TAG_KEY)
}

type BaseFields = Pick<
  ErrorReport,
  | "breadcrumbs"
  | "routePattern"
  | "userAgent"
  | "viewport"
  | "online"
  | "authenticated"
  | "appVersion"
  | "occurredAt"
>

function baseFields(): BaseFields {
  return {
    breadcrumbs: [...state.breadcrumbs],
    routePattern: state.breadcrumbs.at(-1),
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
    authenticated: state.isAuthenticated(),
    appVersion: import.meta.env.VITE_APP_VERSION,
    occurredAt: new Date().toISOString(),
  }
}

function onWindowError(event: ErrorEvent): void {
  reportError(event.error ?? event.message, { kind: "js-error" })
}

function onUnhandledRejection(event: Event): void {
  const reason = (event as Event & { reason?: unknown }).reason
  reportError(reason, { kind: "promise-rejection" })
}

/**
 * 전역 에러 훅을 한 번 설치한다. 운영 호스트에서만 켜지며, 수집기 자체 예외는 전부 삼킨다.
 */
export function installErrorReporter(options: {
  isAuthenticated: () => boolean
  enabled?: boolean
}): void {
  try {
    state.isAuthenticated = options.isAuthenticated
    state.enabled = options.enabled ?? isProductionHost()
    if (state.installed || typeof window === "undefined") return
    state.installed = true
    window.addEventListener("error", onWindowError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)
  } catch {
    // 수집기는 앱을 깨뜨리지 않는다
  }
}

/** 현재 라우트 패턴을 기록한다 (브레드크럼 + 리포트의 routePattern). */
export function setCurrentRoute(routePattern: string): void {
  try {
    if (state.breadcrumbs.at(-1) === routePattern) return
    state.breadcrumbs.push(routePattern)
    if (state.breadcrumbs.length > MAX_BREADCRUMBS) state.breadcrumbs.shift()
  } catch {
    // ignore
  }
}

export function reportError(
  error: unknown,
  extra?: { kind?: ErrorReportKind; componentStack?: string }
): void {
  try {
    enqueue({
      kind: extra?.kind ?? "js-error",
      componentStack: extra?.componentStack,
      ...toErrorShape(error),
    })
  } catch {
    // ignore
  }
}

export function reportApiFailure(
  api: NonNullable<ErrorReport["api"]>,
  error?: unknown
): void {
  try {
    const shape = error === undefined ? { message: "" } : toErrorShape(error)
    enqueue({
      kind: "api-failure",
      ...shape,
      message: shape.message || `${api.name} ${api.status ?? "network"}`,
      api,
    })
  } catch {
    // ignore
  }
}

export function _resetForTests(): void {
  if (state.installed && typeof window !== "undefined") {
    window.removeEventListener("error", onWindowError)
    window.removeEventListener("unhandledrejection", onUnhandledRejection)
  }
  state = initialState()
}
