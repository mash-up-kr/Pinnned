// Microsoft Clarity 세션 녹화에 붙이는 에러 태그. 노션 "개발자 참고"의 검색 안내와 같은 값이어야 한다.
import type { ErrorReportKind } from "./reporter"

export const CLARITY_TAG_KEY = "error"

/** 사용자 지정 태그 값: "종류: 메시지 앞 60자". Clarity 대시보드 필터에서 그대로 검색한다. */
export function clarityErrorTag(report: {
  kind: ErrorReportKind
  message: string
}): string {
  return `${report.kind}: ${report.message.slice(0, 60)}`
}
