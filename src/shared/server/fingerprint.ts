import type { ErrorReport } from "@/shared/api/error-reporter"

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** 메시지에서 가변 부분(URL·UUID·숫자·따옴표 안 문자열)을 자리표시자로 바꿔 같은 원인끼리 모이게 한다. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s'"]+/g, "<url>")
    .replace(UUID, "<id>")
    .replace(/(['"`]).*?\1/g, '""')
    .replace(/\d+/g, "#")
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  )
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}

/**
 * 노션 행 중복 판별 키. 16자리 hex.
 * API 실패는 요청 식별자(operationName 또는 메서드+경로)와 상태만 쓴다 — 메시지는 브라우저마다 다르다.
 */
export async function computeFingerprint(
  report: Pick<
    ErrorReport,
    "kind" | "name" | "message" | "routePattern" | "api"
  >,
  topFrame?: string
): Promise<string> {
  const key = report.api
    ? [
        report.kind,
        report.api.protocol,
        report.api.name,
        report.api.status ?? "",
        report.api.code ?? "",
      ].join("|")
    : [
        report.kind,
        report.name ?? "",
        normalizeMessage(report.message),
        topFrame ?? "",
        report.routePattern ?? "",
      ].join("|")
  return (await sha256Hex(key)).slice(0, 16)
}
